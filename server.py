"""FastAPI Backend Server for Asynchronous Batch Video Processing.

Provides:
- POST /api/jobs/batch: Submit a batch of YouTube URLs for shorts processing
- GET /api/jobs: List all jobs
- GET /api/jobs/{id}: Get specific job status and result
- POST /api/jobs/{id}/render: Re-render short with custom cuts and title
- POST /api/jobs/{id}/reanalyze: Fast in-studio AI highlight re-analysis
- DELETE /api/jobs/{id}: Delete a job
- POST /api/jobs/clear: Clear job history
- GET /api/videos: List all processed YouTube videos with their extracted clips
- GET /api/clips: Retrieve all extracted clips grouped by YouTube video title
- POST /api/shorts/custom-build: Create a new edit job by combining an arbitrary selection of clip IDs
- GET /api/channels: List configured YouTube channels
- POST /api/channels: Add/authenticate a new YouTube channel
- GET /api/shorts: List rendered shorts
- POST /api/shorts/batch-upload: Trigger automated uploads via google-api-python-client
- Static mount /output: Direct streaming of generated MP4 clips with HTTP Range support
"""
import asyncio
import json
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from celery import Celery
from fastapi import FastAPI, HTTPException, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Ensure repo root is in python path
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import render_engine
from celery.signals import worker_process_init

@worker_process_init.connect
def on_worker_process_init(**kwargs):
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    try:
        import render_engine
        print("[celery] worker_process_init: render_engine successfully imported", flush=True)
    except Exception as e:
        print(f"[celery] worker_process_init: failed to import render_engine: {e}", flush=True)

from database import (
    SessionLocal,
    Video,
    ClipCandidate,
    RenderedShort,
    YouTubeChannel,
    init_db,
)
from pathlib import Path
from shorts_generator.pipeline import generate_shorts
from shorts_generator.config import LOCAL_OUTPUT_DIR
from shorts_generator.local.downloader import download_youtube_local, get_youtube_video_title
from shorts_generator.local.transcriber import transcribe_local

OUTPUT_DIR = os.path.abspath(LOCAL_OUTPUT_DIR)
os.makedirs(OUTPUT_DIR, exist_ok=True)

JOBS_DB_PATH = os.path.join(OUTPUT_DIR, "jobs_store.json")

# Celery Configuration for 3x Concurrent Video Processing
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

celery_app = Celery(
    "shorts_tasks",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    worker_concurrency=3,
    worker_prefetch_multiplier=1,
)

# In-memory thread-safe job store
jobs_lock = asyncio.Lock()
jobs_db: Dict[str, Dict[str, Any]] = {}
job_queue: asyncio.Queue = asyncio.Queue()
worker_task: Optional[asyncio.Task] = None
executor = ThreadPoolExecutor(max_workers=3)


def _load_jobs_from_disk() -> Dict[str, Any]:
    global jobs_db
    if os.path.exists(JOBS_DB_PATH):
        try:
            with open(JOBS_DB_PATH, "r", encoding="utf-8") as f:
                disk_jobs = json.load(f)
                for k, v in disk_jobs.items():
                    if k not in jobs_db:
                        jobs_db[k] = v
                    else:
                        jobs_db[k].update(v)
        except Exception as e:
            print(f"[server] Error loading jobs from disk: {e}", flush=True)
    return jobs_db


def _save_jobs_to_disk():
    global jobs_db
    try:
        current_disk = {}
        if os.path.exists(JOBS_DB_PATH):
            try:
                with open(JOBS_DB_PATH, "r", encoding="utf-8") as f:
                    current_disk = json.load(f)
            except Exception:
                current_disk = {}
        current_disk.update(jobs_db)
        temp_path = f"{JOBS_DB_PATH}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(current_disk, f, indent=2)
        os.replace(temp_path, JOBS_DB_PATH)
        jobs_db.update(current_disk)
    except Exception as e:
        print(f"[server] Error saving jobs to disk: {e}", flush=True)


def _save_job_update(job_id: str, job_dict: Dict[str, Any]):
    """Thread-safe and process-safe update of a single job to both memory and disk."""
    global jobs_db
    jobs_db[job_id] = job_dict
    try:
        current_disk = {}
        if os.path.exists(JOBS_DB_PATH):
            try:
                with open(JOBS_DB_PATH, "r", encoding="utf-8") as f:
                    current_disk = json.load(f)
            except Exception:
                current_disk = {}
        current_disk[job_id] = job_dict
        for k, v in jobs_db.items():
            if k not in current_disk:
                current_disk[k] = v
        temp_path = f"{JOBS_DB_PATH}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(current_disk, f, indent=2)
        os.replace(temp_path, JOBS_DB_PATH)
        jobs_db.update(current_disk)
    except Exception as e:
        print(f"[server] Error in _save_job_update: {e}", flush=True)


def to_stream_url(p: Optional[str]) -> Optional[str]:
    """Safely converts local filesystem paths or relative paths to /output/... web stream URLs."""
    if not p:
        return None
    clean = str(p).replace("\\", "/").strip()
    if not clean:
        return None
    if clean.startswith("http://") or clean.startswith("https://"):
        return clean
    if "output/" in clean:
        rel = clean.split("output/", 1)[1]
        return f"/output/{rel}"
    if clean.startswith("/output/"):
        return clean
    base = os.path.basename(clean)
    candidate = os.path.join(OUTPUT_DIR, base)
    if os.path.exists(candidate):
        return f"/output/{base}"
    if clean.endswith(".mp4"):
        return f"/output/{base}"
    return clean if clean.startswith("/") else f"/{clean}"


def _normalize_stream_urls(result: Dict[str, Any], job_out_dir: str) -> Dict[str, Any]:
    """Ensure all clips and the source video contain valid streamable HTTP URLs under /output/."""
    src_path = result.get("source_video_url")
    src_stream = to_stream_url(src_path)
    if src_stream:
        result["source_stream_url"] = src_stream

    all_clip_lists = [
        result.get("shorts", []),
        result.get("candidates", []),
        result.get("highlights", []),
    ]
    for clip_list in all_clip_lists:
        if not isinstance(clip_list, list):
            continue
        for s in clip_list:
            if not isinstance(s, dict):
                continue
            clip_path = s.get("clip_url") or s.get("clip_path")
            if clip_path:
                s["stream_url"] = to_stream_url(clip_path)
            elif not s.get("stream_url"):
                s["stream_url"] = src_stream
            s["source_stream_url"] = src_stream
            if not s.get("source_video_path") and src_path:
                s["source_video_path"] = src_path
    return result


def resolve_local_path(p: Optional[str]) -> Optional[str]:
    """Safely resolves file paths across relative paths, /output/ web URLs, and absolute paths."""
    if not p:
        return None
    if os.path.isabs(p) and os.path.exists(p):
        return p
    clean = p.replace("\\", "/")
    if clean.startswith("/output/"):
        candidate = os.path.join(OUTPUT_DIR, clean[len("/output/"):])
        if os.path.exists(candidate):
            return candidate
    if clean.startswith("output/"):
        candidate = os.path.join(OUTPUT_DIR, clean[len("output/"):])
        if os.path.exists(candidate):
            return candidate
    candidate = os.path.join(OUTPUT_DIR, os.path.basename(clean))
    if os.path.exists(candidate):
        return candidate
    if os.path.exists(p):
        return os.path.abspath(p)
    return None


def _save_video_and_clips_to_db(job: Dict[str, Any], result: Dict[str, Any]):
    """Persist processed video and its extracted clip candidates to MySQL database."""
    db = SessionLocal()
    try:
        vid_id = job.get("video_id") or job["id"]
        v = db.query(Video).filter(Video.id == vid_id).first()

        yt_title = result.get("video_title") or job.get("video_title")
        yt_url = job.get("url") or result.get("source_video_url") or ""
        if not yt_title or yt_title == "RANKING VIRAL MOMENTS" or yt_title.startswith("Video ("):
            if "youtube.com" in yt_url or "youtu.be" in yt_url:
                try:
                    fetched_title = get_youtube_video_title(yt_url, OUTPUT_DIR)
                    if fetched_title and fetched_title != "YouTube Video":
                        yt_title = fetched_title
                except Exception as ex:
                    print(f"[db] Could not get YouTube title for {yt_url}: {ex}", flush=True)
        if not yt_title:
            yt_title = job.get("header_title") or result.get("header_title") or f"Video ({vid_id[:8]})"

        job["video_title"] = yt_title
        result["video_title"] = yt_title

        if not v:
            transcript = result.get("transcript") or {}
            dur = transcript.get("duration", 0.0) if isinstance(transcript, dict) else 0.0
            src_url = result.get("source_video_url") or ""
            t_path = src_url.rsplit(".", 1)[0] + ".transcript.json" if src_url else None
            
            v = Video(
                id=vid_id,
                youtube_url=yt_url,
                title=yt_title,
                duration=float(dur),
                source_path=src_url,
                transcript_path=t_path if (t_path and os.path.exists(t_path)) else None,
            )
            db.add(v)
            db.flush()
        else:
            if yt_title and (not v.title or v.title == "RANKING VIRAL MOMENTS" or v.title.startswith("Video (")):
                v.title = yt_title
            if not v.source_path and result.get("source_video_url"):
                v.source_path = result.get("source_video_url")

        candidates = result.get("candidates", []) or result.get("highlights", []) or job.get("candidates", [])
        for idx, c in enumerate(candidates):
            raw_cid = str(c.get("id") or f"cand_{idx+1}")
            if not raw_cid.startswith(f"{vid_id}_"):
                cid = f"{vid_id}_{raw_cid}"
            else:
                cid = raw_cid
            c["id"] = cid

            existing_c = db.query(ClipCandidate).filter(ClipCandidate.id == cid).first()
            if not existing_c:
                existing_c = db.query(ClipCandidate).filter(
                    ClipCandidate.video_id == v.id,
                    ClipCandidate.rank_title == (c.get("rank_title") or c.get("title"))
                ).first()

            raw_title = c.get("rank_title") or c.get("title") or f"Moment #{idx+1}"
            if not existing_c:
                clip_row = ClipCandidate(
                    id=cid,
                    video_id=v.id,
                    rank_title=raw_title,
                    emoji=c.get("emoji") or "🔥",
                    start_time=float(c.get("start_time", 0.0)),
                    end_time=float(c.get("end_time", 0.0)),
                    virality_score=int(c.get("virality_score") or c.get("score") or 90),
                    hook_sentence=c.get("hook_sentence"),
                )
                db.add(clip_row)
            else:
                existing_c.rank_title = raw_title
                existing_c.start_time = float(c.get("start_time", existing_c.start_time))
                existing_c.end_time = float(c.get("end_time", existing_c.end_time))
                if c.get("emoji"):
                    existing_c.emoji = c.get("emoji")
                if c.get("virality_score") or c.get("score"):
                    existing_c.virality_score = int(c.get("virality_score") or c.get("score"))
                if c.get("hook_sentence"):
                    existing_c.hook_sentence = c.get("hook_sentence")

        final_mp4 = os.path.join(OUTPUT_DIR, f"job_{job['id']}", "final_short.mp4")
        if os.path.exists(final_mp4):
            short_id = f"short_{vid_id}"
            existing_rs = db.query(RenderedShort).filter(RenderedShort.id == short_id).first()
            if not existing_rs:
                top_ids = [str(c.get("id")) for c in candidates[:min(3, len(candidates))]]
                rs = RenderedShort(
                    id=short_id,
                    header_title=job.get("header_title") or result.get("header_title") or "RANKING VIRAL MOMENTS",
                    selected_clip_ids=top_ids,
                    output_file_path=final_mp4,
                    assigned_channel=job.get("channel_handle"),
                    is_uploaded=False,
                )
                db.add(rs)

        db.commit()
        print(f"[db] Successfully persisted video '{yt_title}' and {len(candidates)} clips to MySQL.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"[db] Warning: could not persist video to MySQL: {e}", flush=True)
    finally:
        db.close()


def _process_job_sync(job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = job["id"]
    job_out_dir = os.path.join(OUTPUT_DIR, f"job_{job_id}")
    os.makedirs(job_out_dir, exist_ok=True)

    print(f"[worker] Starting job {job_id} for URL: {job['url']}", flush=True)
    num_clips = job.get("num_clips", 10)
    result = generate_shorts(
        youtube_url=job["url"],
        num_clips=num_clips,
        aspect_ratio=job.get("aspect_ratio", "9:16"),
        download_format=job.get("download_format", "720"),
        mode=job.get("mode", "local"),
        out_dir=job_out_dir,
        user_prompt=job.get("user_prompt"),
    )
    result = _normalize_stream_urls(result, job_out_dir)

    # Compile initial Ranking Short for top 3 candidates
    header_title = result.get("header_title") or "RANKING VIRAL MOMENTS"
    candidates = result.get("candidates", []) or result.get("highlights", [])
    if candidates:
        top_candidates = candidates[:min(3, len(candidates))]
        final_mp4 = os.path.join(job_out_dir, "final_short.mp4")
        try:
            render_engine.render_ranking_short(
                source_video_path=result.get("source_video_url"),
                transcript=result.get("transcript"),
                header_title=header_title,
                selected_clips=top_candidates,
                work_dir=os.path.join(job_out_dir, "render_work"),
                final_output_path=final_mp4,
                layout_mode=job.get("layout_mode", "1:1"),
                channel_handle=job.get("channel_handle"),
                captions_enabled=job.get("captions_enabled", True),
            )
            import shutil
            shutil.copyfile(final_mp4, os.path.join(OUTPUT_DIR, "final_short.mp4"))
            job["final_video_url"] = f"/output/job_{job_id}/final_short.mp4"
            print(f"[worker] Initial ranking short compiled: {final_mp4}", flush=True)
        except Exception as e:
            print(f"[worker] Initial auto-render error: {e}", flush=True)

    # Persist to MySQL
    _save_video_and_clips_to_db(job, result)

    print(f"[worker] Completed job {job_id}. Extracted {len(candidates)} candidates.", flush=True)
    return result


@celery_app.task(name="process_video_task", bind=True)
def process_video_task(self, job_id: str, job_data: Optional[Dict[str, Any]] = None):
    """Celery background task executing with up to 3x concurrency."""
    print(f"[celery] Starting background task for job {job_id}", flush=True)
    job = job_data
    if not job:
        _load_jobs_from_disk()
        job = jobs_db.get(job_id)

    if not job:
        print(f"[celery] Job {job_id} not found", flush=True)
        return {"error": f"Job {job_id} not found"}

    job["status"] = "processing"
    job["progress"] = "Processing video highlights and cropping..."
    job["started_at"] = datetime.now(timezone.utc).isoformat()
    _save_job_update(job_id, job)

    try:
        result = _process_job_sync(job)
        job["status"] = "completed"
        job["progress"] = "All clips generated successfully."
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        job["result"] = result
        job["error"] = None
        _save_job_update(job_id, job)
        return {"status": "success", "job_id": job_id}
    except Exception as exc:
        print(f"[celery] Job {job_id} failed: {exc}", flush=True)
        job["status"] = "failed"
        job["progress"] = "Failed during processing."
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        job["error"] = str(exc)
        _save_job_update(job_id, job)
        raise exc


async def background_worker():
    """Local async queue worker as backup/fallback when Celery is not active."""
    print("[worker] Background video processing queue worker started.", flush=True)
    while True:
        try:
            job_id = await job_queue.get()
            async with jobs_lock:
                job = jobs_db.get(job_id)
                if not job or job.get("status") == "completed":
                    job_queue.task_done()
                    continue
                job["status"] = "processing"
                job["progress"] = "Processing video highlights and cropping..."
                job["started_at"] = datetime.now(timezone.utc).isoformat()
                _save_jobs_to_disk()

            loop = asyncio.get_running_loop()
            try:
                result = await loop.run_in_executor(executor, _process_job_sync, job)
                async with jobs_lock:
                    job["status"] = "completed"
                    job["progress"] = "All clips generated successfully."
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                    job["result"] = result
                    job["error"] = None
                    _save_jobs_to_disk()
            except Exception as exc:
                print(f"[worker] Job {job_id} failed: {exc}", flush=True)
                async with jobs_lock:
                    job["status"] = "failed"
                    job["progress"] = "Failed during processing."
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                    job["error"] = str(exc)
                    _save_jobs_to_disk()
            finally:
                job_queue.task_done()
        except asyncio.CancelledError:
            print("[worker] Background worker cancelled.", flush=True)
            break
        except Exception as e:
            print(f"[worker] Unexpected worker error: {e}", flush=True)
            await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker_task
    init_db()
    _load_jobs_from_disk()
    for j_id, j_data in jobs_db.items():
        if j_data.get("status") in ("queued", "processing"):
            j_data["status"] = "queued"
            j_data["progress"] = "Queued for processing..."
            job_queue.put_nowait(j_id)
    worker_task = asyncio.create_task(background_worker())

    # Startup recovery: fix jobs stuck as "rendering" from a crashed previous server
    recovered = 0
    for j_id, j_data in jobs_db.items():
        if j_data.get("render_status") == "rendering":
            expected_mp4 = os.path.join(OUTPUT_DIR, f"job_{j_id}", "final_short.mp4")
            if os.path.exists(expected_mp4):
                j_data["render_status"] = "completed"
                j_data["status"] = "completed"
                j_data["render_error"] = None
                j_data["render_progress"] = "Compilation completed successfully."
                if not j_data.get("final_video_url"):
                    j_data["final_video_url"] = f"/output/job_{j_id}/final_short.mp4"
                recovered += 1
            else:
                # Render was interrupted and output doesn't exist — mark as failed
                j_data["render_status"] = "failed"
                j_data["render_error"] = "Server restarted during render. Please re-render."
                j_data["render_progress"] = "Render interrupted by server restart."
                recovered += 1
    if recovered:
        print(f"[startup] Recovered {recovered} stuck 'rendering' jobs.", flush=True)
        _save_jobs_to_disk()
    yield
    if worker_task:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass
    executor.shutdown(wait=False)


app = FastAPI(
    title="AI Shorts Generator Batch API",
    description="Asynchronous batch video processing service with MySQL persistence and Celery queue",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/output", StaticFiles(directory=OUTPUT_DIR, html=False), name="output")


# Models
class BatchJobRequest(BaseModel):
    urls: List[str] = Field(..., min_length=1, description="List of YouTube video URLs to process")
    user_prompt: Optional[str] = Field(None, description="Optional AI guidance prompt (e.g. 'Return all the stewie best moments')")
    num_clips: Optional[int] = Field(10, ge=1, le=10, description="Number of shorts to generate per video")
    aspect_ratio: Optional[str] = Field("9:16", description="Target aspect ratio")
    layout_mode: Optional[str] = Field("1:1", description="Layout mode: 1:1, 16:9, or 9:16")
    template_type: Optional[str] = Field("ranking", description="Template mode: 'ranking' or 'single_title'")
    channel_handle: Optional[str] = Field(None, description="Watermark channel handle")
    download_format: Optional[str] = Field("720", description="Download resolution")
    mode: Optional[str] = Field("local", description="'local' or 'api'")
    captions_enabled: Optional[bool] = Field(True, description="Enable or disable burned-in captions")


class RenderJobRequest(BaseModel):
    header_title: Optional[str] = None
    selected_clip_ids: Optional[List[str]] = None
    clips: Optional[List[Dict[str, Any]]] = None
    all_clips: Optional[List[Dict[str, Any]]] = None
    layout_mode: Optional[str] = Field("1:1", description="Layout mode: 1:1, 16:9, or 9:16")
    template_type: Optional[str] = Field("ranking", description="Template mode: 'ranking' or 'single_title'")
    channel_handle: Optional[str] = Field(None, description="Watermark channel handle")
    captions_enabled: Optional[bool] = Field(True, description="Enable or disable burned-in captions")


class ReanalyzeJobRequest(BaseModel):
    user_prompt: str = Field(..., min_length=1, description="AI prompt directive")
    num_clips: Optional[int] = Field(10, ge=1, le=10, description="Target number of moments")


class CustomBuildRequest(BaseModel):
    clip_ids: List[str] = Field(..., min_length=1, description="List of clip IDs to combine")
    header_title: Optional[str] = Field("RANKING VIRAL MOMENTS", description="Hook title")
    layout_mode: Optional[str] = Field("1:1", description="Layout mode: 1:1, 16:9, or 9:16")
    channel_handle: Optional[str] = Field(None, description="Watermark handle")
    captions_enabled: Optional[bool] = Field(True, description="Enable captions")


class PrecutClipItem(BaseModel):
    url: str = Field(..., description="YouTube URL or local video file path")
    title: Optional[str] = Field(None, description="Optional custom rank title")


class AssembleClipsRequest(BaseModel):
    clips: List[PrecutClipItem] = Field(..., min_length=2, max_length=15, description="List of pre-cut clips to assemble")
    header_title: Optional[str] = Field("RANKING TOP 5 MOMENTS", description="Top hook banner title")
    layout_mode: Optional[str] = Field("1:1", description="Layout mode: 1:1, 16:9, or 9:16")
    channel_handle: Optional[str] = Field(None, description="Watermark channel handle")
    captions_enabled: Optional[bool] = Field(True, description="Enable or disable burned-in captions")


class ChannelCreateRequest(BaseModel):
    channel_name: str = Field(..., min_length=1, description="Channel display name")
    credentials_json_path: str = Field(..., min_length=1, description="Path to OAuth JSON credentials")


class BatchUploadItem(BaseModel):
    short_id: str
    channel_id: str
    title: str
    description: Optional[str] = ""
    tags: Optional[List[str]] = None
    privacy_status: Optional[str] = "public"


class BatchUploadRequest(BaseModel):
    uploads: List[BatchUploadItem]


def _enrich_job(job: Dict[str, Any]) -> Dict[str, Any]:
    j = dict(job)
    j.setdefault("final_video_url", None)
    j.setdefault("source_stream_url", None)
    j.setdefault("header_title", None)
    j.setdefault("candidates", None)
    j.setdefault("render_status", "idle")
    j.setdefault("render_error", None)
    j.setdefault("render_progress", None)
    j.setdefault("template_type", "ranking")

    res = j.get("result")
    if res and isinstance(res, dict):
        if not j["source_stream_url"]:
            raw_src = res.get("source_stream_url") or res.get("source_video_url")
            j["source_stream_url"] = to_stream_url(raw_src)
        if not j["header_title"]:
            j["header_title"] = res.get("header_title")
        if not j["candidates"]:
            j["candidates"] = res.get("candidates") or res.get("highlights") or res.get("shorts")

    if not j["source_stream_url"]:
        v_url = j.get("url") or ""
        vid = None
        if "v=" in v_url:
            vid = v_url.split("v=")[1].split("&")[0]
        elif "youtu.be/" in v_url:
            vid = v_url.split("youtu.be/")[1].split("?")[0]
        if vid:
            cand = os.path.join(OUTPUT_DIR, f"source_{vid}.mp4")
            if os.path.exists(cand):
                j["source_stream_url"] = f"/output/source_{vid}.mp4"

    if j.get("source_stream_url"):
        j["source_stream_url"] = to_stream_url(j["source_stream_url"])

    # Ensure all candidates have stream_url and source_stream_url set to valid stream URL
    if j.get("candidates") and isinstance(j["candidates"], list):
        for c in j["candidates"]:
            if isinstance(c, dict):
                if not c.get("source_stream_url"):
                    c["source_stream_url"] = j["source_stream_url"]
                else:
                    c["source_stream_url"] = to_stream_url(c["source_stream_url"])

                if not c.get("stream_url"):
                    c["stream_url"] = j["source_stream_url"]
                else:
                    c["stream_url"] = to_stream_url(c["stream_url"])

    if not j["final_video_url"]:
        cand1 = os.path.join(OUTPUT_DIR, f"job_{j['id']}", "final_short.mp4")
        cand2 = os.path.join(OUTPUT_DIR, f"job_job_{j['id']}", "final_short.mp4")
        if os.path.exists(cand1):
            j["final_video_url"] = f"/output/job_{j['id']}/final_short.mp4"
            if j.get("render_status") == "idle":
                j["render_status"] = "completed"
        elif os.path.exists(cand2):
            j["final_video_url"] = f"/output/job_job_{j['id']}/final_short.mp4"
            if j.get("render_status") == "idle":
                j["render_status"] = "completed"
    else:
        j["final_video_url"] = to_stream_url(j["final_video_url"])

    return j


# REST Endpoints
@app.post("/api/jobs/batch", status_code=status.HTTP_202_ACCEPTED)
async def create_batch_jobs(request: BatchJobRequest):
    batch_id = f"batch_{uuid.uuid4().hex[:8]}"
    created_jobs = []

    async with jobs_lock:
        for url in request.urls:
            cleaned_url = url.strip()
            if not cleaned_url:
                continue

            job_id = f"job_{uuid.uuid4().hex[:8]}"
            job_data = {
                "id": job_id,
                "batch_id": batch_id,
                "url": cleaned_url,
                "status": "queued",
                "progress": "Queued for 3x concurrent processing...",
                "user_prompt": request.user_prompt.strip() if request.user_prompt else None,
                "num_clips": request.num_clips,
                "aspect_ratio": request.aspect_ratio,
                "layout_mode": request.layout_mode,
                "channel_handle": request.channel_handle.strip() if request.channel_handle else None,
                "captions_enabled": request.captions_enabled,
                "download_format": request.download_format,
                "mode": request.mode,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "started_at": None,
                "completed_at": None,
                "final_video_url": None,
                "source_stream_url": None,
                "header_title": None,
                "candidates": None,
                "render_status": "idle",
                "render_error": None,
                "result": None,
                "error": None,
            }
            jobs_db[job_id] = job_data
            created_jobs.append(job_data)

        # Save all created jobs to disk first before dispatching tasks
        _save_jobs_to_disk()

        # Enqueue with Celery for 3x concurrent execution
        for j in created_jobs:
            j_id = j["id"]
            try:
                process_video_task.delay(j_id, j)
            except Exception as e:
                print(f"[server] Celery dispatch fallback: {e}", flush=True)
                job_queue.put_nowait(j_id)

    return {
        "batch_id": batch_id,
        "total_jobs": len(created_jobs),
        "jobs": [_enrich_job(j) for j in created_jobs],
    }


@app.get("/api/jobs")
async def list_jobs():
    async with jobs_lock:
        _load_jobs_from_disk()
        sorted_jobs = sorted(
            jobs_db.values(),
            key=lambda x: x.get("created_at", ""),
            reverse=True,
        )
        return [_enrich_job(j) for j in sorted_jobs]


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    async with jobs_lock:
        _load_jobs_from_disk()
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail=f"Job with id '{job_id}' not found")
        return _enrich_job(jobs_db[job_id])


def _execute_background_render(
    job_id: str,
    header_title: str,
    layout_mode: str,
    channel_handle: Optional[str],
    captions_enabled: bool,
    clips_to_render: List[Dict[str, Any]],
    source_path: str,
    custom_mp4: str,
    work_dir: str,
    transcript: Optional[Dict[str, Any]],
    template_type: str = "ranking",
):
    """Background rendering worker running in a thread pool without blocking the async event loop."""
    print(f"[render_worker] Starting background render for job {job_id} ({len(clips_to_render)} clips, template: {template_type})...", flush=True)

    def on_progress(clip_idx: int, total_clips: int, clip_title: str):
        job = jobs_db.get(job_id)
        if job:
            # Check if this render was cancelled by a newer render request
            if job.get("render_status") == "cancelled":
                print(f"[render_worker] Render cancelled for job {job_id} (superseded by new render).", flush=True)
                raise RuntimeError("Render cancelled — superseded by new render request.")
            job["render_progress"] = f"Compiling clip {clip_idx}/{total_clips}: {clip_title}"
            _save_job_update(job_id, job)

    try:
        render_engine.render_ranking_short(
            source_video_path=source_path,
            transcript=transcript,
            header_title=header_title,
            selected_clips=clips_to_render,
            work_dir=work_dir,
            final_output_path=custom_mp4,
            layout_mode=layout_mode,
            channel_handle=channel_handle,
            captions_enabled=captions_enabled,
            progress_callback=on_progress,
            template_type=template_type,
        )
        import shutil
        shutil.copyfile(custom_mp4, os.path.join(OUTPUT_DIR, "final_short.mp4"))

        job = jobs_db.get(job_id) or {}
        job["final_video_url"] = f"/output/job_{job_id}/final_short.mp4"
        job["rendered_header_title"] = header_title
        job["layout_mode"] = layout_mode
        job["template_type"] = template_type
        job["channel_handle"] = channel_handle
        job["captions_enabled"] = captions_enabled
        job["render_status"] = "completed"
        job["status"] = "completed"
        job["render_error"] = None
        job["render_progress"] = "Compilation completed successfully."
        _save_job_update(job_id, job)

        # Update MySQL RenderedShort
        db = SessionLocal()
        try:
            short_id = f"short_{job_id}"
            rs = db.query(RenderedShort).filter(RenderedShort.id == short_id).first()
            if not rs:
                rs = RenderedShort(
                    id=short_id,
                    header_title=header_title,
                    selected_clip_ids=[str(c.get("id")) for c in clips_to_render],
                    output_file_path=custom_mp4,
                    assigned_channel=channel_handle,
                    is_uploaded=False,
                )
                db.add(rs)
            else:
                rs.header_title = header_title
                rs.selected_clip_ids = [str(c.get("id")) for c in clips_to_render]
                rs.output_file_path = custom_mp4
                rs.assigned_channel = channel_handle
            db.commit()
        finally:
            db.close()

        print(f"[render_worker] Successfully completed background render for job {job_id}.", flush=True)

    except Exception as e:
        print(f"[render_worker] Render error on job {job_id}: {e}", flush=True)
        job = jobs_db.get(job_id) or {}
        job["render_status"] = "failed"
        job["render_error"] = str(e)
        job["render_progress"] = f"Compilation failed: {str(e)}"
        _save_job_update(job_id, job)


@app.post("/api/jobs/{job_id}/render", status_code=status.HTTP_202_ACCEPTED)
async def render_custom_short(job_id: str, request: RenderJobRequest, background_tasks: BackgroundTasks):
    async with jobs_lock:
        if job_id not in jobs_db:
            _load_jobs_from_disk()
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail=f"Job with id '{job_id}' not found")
        job = jobs_db[job_id]

        # Prevent concurrent renders — cancel any in-progress render for this job
        if job.get("render_status") == "rendering":
            job["render_status"] = "cancelled"
            _save_jobs_to_disk()
            import time; time.sleep(0.5)  # brief pause to let old worker notice

    res = job.get("result") or {}
    candidates = res.get("candidates", []) or res.get("highlights", []) or job.get("candidates", [])
    id_to_clip = {str(c.get("id")): c for c in candidates if c.get("id") is not None}

    clips_to_render = []
    if request.clips:
        clips_to_render = request.clips
    elif request.selected_clip_ids:
        for cid in request.selected_clip_ids:
            if cid in id_to_clip:
                clips_to_render.append(id_to_clip[cid])

    if not clips_to_render:
        clips_to_render = candidates

    if not clips_to_render:
        raise HTTPException(status_code=400, detail="No valid clips specified for rendering.")

    # Resolve per-clip source_video_path to absolute paths
    for clip in clips_to_render:
        raw_src = clip.get("source_video_path") or clip.get("source_path")
        if raw_src:
            resolved = resolve_local_path(raw_src)
            if resolved:
                clip["source_video_path"] = resolved

    source_path = resolve_local_path(res.get("source_video_url"))
    if not source_path:
        vid = job.get("url", "").split("v=")[-1].split("&")[0] if "v=" in job.get("url", "") else ""
        if vid:
            candidate_src = resolve_local_path(f"source_{vid}.mp4")
            if candidate_src:
                source_path = candidate_src
    if not source_path:
        for c in clips_to_render:
            p = resolve_local_path(c.get("source_video_path") or c.get("source_path") or c.get("stream_url"))
            if p:
                source_path = p
                break
    if not source_path:
        raise HTTPException(status_code=400, detail="Source video file not found.")

    # Resolve transcript (check disk cache if missing)
    transcript_data = res.get("transcript") or job.get("transcript")
    if not transcript_data and source_path:
        stem = Path(source_path).stem
        t_cand = os.path.join(OUTPUT_DIR, f"{stem}.transcript.json")
        if os.path.exists(t_cand):
            try:
                with open(t_cand, "r", encoding="utf-8") as tf:
                    transcript_data = json.load(tf)
            except Exception:
                pass

    job_out_dir = os.path.join(OUTPUT_DIR, f"job_{job_id}")
    os.makedirs(job_out_dir, exist_ok=True)
    custom_mp4 = os.path.join(job_out_dir, "final_short.mp4")
    work_dir = os.path.join(job_out_dir, "custom_render_work")

    header_title = (request.header_title or job.get("header_title") or "RANKING VIRAL MOMENTS").strip()
    layout_mode = request.layout_mode or job.get("layout_mode", "1:1")
    channel_handle = request.channel_handle or job.get("channel_handle")
    captions_enabled = request.captions_enabled if request.captions_enabled is not None else True
    template_type = request.template_type or job.get("template_type", "ranking")

    # Persist updated cuts to the Job and to MySQL database
    clips_to_persist = request.all_clips or request.clips or []
    if clips_to_persist:
        # 1. Update candidate cuts inside job
        async with jobs_lock:
            def _update_cand_list(cand_list):
                if not cand_list or not isinstance(cand_list, list):
                    return
                for c_up in clips_to_persist:
                    up_id = str(c_up.get("id"))
                    for cand in cand_list:
                        if not isinstance(cand, dict):
                            continue
                        cand_id = str(cand.get("id"))
                        if (
                            cand_id == up_id
                            or cand_id.endswith(f"_{up_id}")
                            or up_id.endswith(f"_{cand_id}")
                            or cand.get("rank_title") == (c_up.get("rank_title") or c_up.get("title"))
                        ):
                            if c_up.get("start_time") is not None:
                                cand["start_time"] = float(c_up["start_time"])
                            if c_up.get("end_time") is not None:
                                cand["end_time"] = float(c_up["end_time"])
                            if cand.get("start_time") is not None and cand.get("end_time") is not None:
                                cand["duration"] = float(cand["end_time"]) - float(cand["start_time"])
                            new_rt = c_up.get("rank_title") or c_up.get("title")
                            if new_rt:
                                cand["rank_title"] = new_rt
                                cand["title"] = new_rt
                            if c_up.get("emoji"):
                                cand["emoji"] = c_up["emoji"]
                            if c_up.get("virality_score") or c_up.get("score"):
                                cand["score"] = int(c_up.get("virality_score") or c_up.get("score"))
                                cand["virality_score"] = cand["score"]
                            if c_up.get("hook_sentence"):
                                cand["hook_sentence"] = c_up["hook_sentence"]
                            break

            _update_cand_list(job.get("candidates"))
            if job.get("result") and isinstance(job["result"], dict):
                _update_cand_list(job["result"].get("candidates"))
                _update_cand_list(job["result"].get("highlights"))

            # Update render settings in job
            job["header_title"] = header_title
            job["layout_mode"] = layout_mode
            job["channel_handle"] = channel_handle
            job["captions_enabled"] = captions_enabled
            job["template_type"] = template_type
            job["render_status"] = "rendering"
            job["render_progress"] = f"Starting compilation of {len(clips_to_render)} clips..."
            job["render_error"] = None
            _save_jobs_to_disk()

        # 2. Update cuts in MySQL ClipCandidate table
        vid_id = job.get("video_id") or job["id"]
        db = SessionLocal()
        try:
            v = db.query(Video).filter(Video.id == vid_id).first()
            if not v:
                _save_video_and_clips_to_db(job, job.get("result", {}))
                v = db.query(Video).filter(Video.id == vid_id).first()

            for c_up in clips_to_persist:
                up_id = str(c_up.get("id"))
                new_start = float(c_up.get("start_time", 0.0))
                new_end = float(c_up.get("end_time", 0.0))
                new_title = c_up.get("rank_title") or c_up.get("title") or "Moment"

                cand_row = db.query(ClipCandidate).filter(ClipCandidate.id == up_id).first()
                if not cand_row and not up_id.startswith(f"{vid_id}_"):
                    cand_row = db.query(ClipCandidate).filter(ClipCandidate.id == f"{vid_id}_{up_id}").first()
                if not cand_row and v:
                    cand_row = db.query(ClipCandidate).filter(
                        ClipCandidate.video_id == v.id,
                        ClipCandidate.rank_title == new_title
                    ).first()

                if cand_row:
                    cand_row.start_time = new_start
                    cand_row.end_time = new_end
                    cand_row.rank_title = new_title
                    if c_up.get("emoji"):
                        cand_row.emoji = c_up["emoji"]
                    if c_up.get("virality_score") or c_up.get("score"):
                        cand_row.virality_score = int(c_up.get("virality_score") or c_up.get("score"))
                    if c_up.get("hook_sentence"):
                        cand_row.hook_sentence = c_up["hook_sentence"]
                elif v:
                    row_id = up_id if up_id.startswith(f"{vid_id}_") else f"{vid_id}_{up_id}"
                    new_row = ClipCandidate(
                        id=row_id,
                        video_id=v.id,
                        rank_title=new_title,
                        emoji=c_up.get("emoji") or "🔥",
                        start_time=new_start,
                        end_time=new_end,
                        virality_score=int(c_up.get("virality_score") or c_up.get("score") or 90),
                        hook_sentence=c_up.get("hook_sentence"),
                    )
                    db.add(new_row)
            db.commit()
            print(f"[db] Successfully persisted {len(clips_to_persist)} cuts to MySQL for job {job_id}.", flush=True)
        except Exception as ex:
            db.rollback()
            print(f"[db] Warning: failed to persist cuts to MySQL: {ex}", flush=True)
        finally:
            db.close()
    else:
        async with jobs_lock:
            job["render_status"] = "rendering"
            job["render_progress"] = f"Starting compilation of {len(clips_to_render)} clips..."
            job["render_error"] = None
            job["template_type"] = template_type
            _save_jobs_to_disk()

    # Launch in background thread without blocking the FastAPI event loop or hitting proxy timeouts
    background_tasks.add_task(
        _execute_background_render,
        job_id=job_id,
        header_title=header_title,
        layout_mode=layout_mode,
        channel_handle=channel_handle,
        captions_enabled=captions_enabled,
        clips_to_render=clips_to_render,
        source_path=source_path,
        custom_mp4=custom_mp4,
        work_dir=work_dir,
        transcript=transcript_data,
        template_type=template_type,
    )

    return {
        "status": "rendering",
        "render_status": "rendering",
        "message": f"Compilation started for {len(clips_to_render)} clips.",
        "job_id": job_id,
        "job": _enrich_job(job),
    }


@app.post("/api/jobs/{job_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_job(job_id: str):
    async with jobs_lock:
        if job_id not in jobs_db:
            _load_jobs_from_disk()
        job = jobs_db.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job with id '{job_id}' not found")

        job["status"] = "queued"
        job["progress"] = "Queued for retry..."
        job["error"] = None
        _save_jobs_to_disk()

    try:
        process_video_task.delay(job_id, job)
    except Exception as e:
        print(f"[server] Celery dispatch fallback: {e}", flush=True)
        job_queue.put_nowait(job_id)

    return {"status": "queued", "job_id": job_id, "message": "Job re-queued for processing"}


@app.post("/api/jobs/{job_id}/reanalyze")
async def reanalyze_job(job_id: str, request: ReanalyzeJobRequest):
    async with jobs_lock:
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail=f"Job with id '{job_id}' not found")
        job = jobs_db[job_id]

    res = job.get("result") or {}
    transcript = res.get("transcript") or job.get("transcript")
    if not transcript or not transcript.get("segments"):
        src = res.get("source_video_url") or job.get("source_stream_url")
        if not src and job.get("url"):
            vid = job.get("url", "").split("v=")[-1].split("&")[0]
            src = os.path.join(OUTPUT_DIR, f"source_{vid}.mp4")
        if src:
            stem = Path(src).stem
            t_cand = os.path.join(OUTPUT_DIR, f"{stem}.transcript.json")
            if os.path.exists(t_cand):
                try:
                    with open(t_cand, "r", encoding="utf-8") as tf:
                        transcript = json.load(tf)
                except Exception:
                    pass
    if not transcript or not transcript.get("segments"):
        raise HTTPException(status_code=400, detail="Job does not have a cached transcript.")

    clean_prompt = request.user_prompt.strip()
    from shorts_generator.highlights import get_highlights, call_muapi_llm
    from shorts_generator.local.llm import call_local_llm
    from shorts_generator.config import MUAPI_API_KEY

    llm_fn = call_local_llm if job.get("mode") == "local" or not MUAPI_API_KEY else call_muapi_llm
    num_clips = request.num_clips or job.get("num_clips", 10)

    try:
        highlights_result = get_highlights(
            transcript=transcript,
            num_clips=num_clips,
            llm_fn=llm_fn,
            user_prompt=clean_prompt,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI highlight re-analysis failed: {str(exc)}")

    new_header_title = highlights_result.get("header_title", "RANKING VIRAL MOMENTS")
    new_candidates = highlights_result.get("candidates", [])

    async with jobs_lock:
        job["user_prompt"] = clean_prompt
        job["header_title"] = new_header_title
        job["rendered_header_title"] = new_header_title
        job["candidates"] = new_candidates
        if "result" in job and isinstance(job["result"], dict):
            job["result"]["header_title"] = new_header_title
            job["result"]["candidates"] = new_candidates
            job["result"]["highlights"] = new_candidates
            job["result"]["user_prompt"] = clean_prompt
        _save_jobs_to_disk()

    return {
        "status": "success",
        "header_title": new_header_title,
        "candidates": new_candidates,
        "job": _enrich_job(job),
    }


# Database REST API Endpoints
@app.get("/api/videos")
def list_videos():
    """List all processed YouTube videos with their extracted clips."""
    db = SessionLocal()
    try:
        videos = db.query(Video).order_by(Video.created_at.desc()).all()
        result = []
        for v in videos:
            result.append({
                "id": v.id,
                "youtube_url": v.youtube_url,
                "title": v.title,
                "duration": v.duration,
                "source_path": v.source_path,
                "transcript_path": v.transcript_path,
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "clips": [
                    {
                        "id": c.id,
                        "video_id": c.video_id,
                        "rank_title": c.rank_title,
                        "emoji": c.emoji or "🔥",
                        "start_time": c.start_time,
                        "end_time": c.end_time,
                        "virality_score": c.virality_score,
                        "hook_sentence": c.hook_sentence,
                    }
                    for c in v.clips
                ],
            })
        return result
    finally:
        db.close()


@app.get("/api/clips")
def list_grouped_clips():
    """Retrieve all extracted clips grouped by YouTube video title."""
    db = SessionLocal()
    try:
        videos = db.query(Video).order_by(Video.created_at.desc()).all()
        grouped = []
        for v in videos:
            if not v.clips:
                continue

            # Ensure v.title is actual YouTube video title if generic
            if not v.title or v.title == "RANKING VIRAL MOMENTS" or v.title.startswith("Video ("):
                if v.youtube_url and ("youtube.com" in v.youtube_url or "youtu.be" in v.youtube_url):
                    try:
                        fetched = get_youtube_video_title(v.youtube_url, OUTPUT_DIR)
                        if fetched and fetched != "YouTube Video":
                            v.title = fetched
                            db.commit()
                    except Exception:
                        pass

            src_stream = to_stream_url(v.source_path)

            grouped.append({
                "video_id": v.id,
                "video_title": v.title or f"Video ({v.id[:8]})",
                "youtube_url": v.youtube_url,
                "duration": v.duration,
                "source_stream_url": src_stream,
                "clips": [
                    {
                        "id": c.id,
                        "video_id": c.video_id,
                        "rank_title": c.rank_title,
                        "emoji": c.emoji or "🔥",
                        "start_time": c.start_time,
                        "end_time": c.end_time,
                        "virality_score": c.virality_score,
                        "hook_sentence": c.hook_sentence,
                        "source_stream_url": src_stream,
                        "video_title": v.title,
                    }
                    for c in v.clips
                ],
            })
        return grouped
    finally:
        db.close()


@app.post("/api/shorts/custom-build")
async def custom_build_short(request: CustomBuildRequest):
    """Create a new edit job by combining an arbitrary selection of clip IDs across any video."""
    db = SessionLocal()
    try:
        clips_data = []
        first_src_url = None

        for cid in request.clip_ids:
            c = db.query(ClipCandidate).filter(ClipCandidate.id == cid).first()
            if not c:
                continue
            v = c.video
            src_stream = to_stream_url(v.source_path) if v else None
            if not first_src_url and src_stream:
                first_src_url = src_stream

            t_data = None
            if v and v.transcript_path and os.path.exists(v.transcript_path):
                try:
                    with open(v.transcript_path, "r", encoding="utf-8") as tf:
                        t_data = json.load(tf)
                except Exception:
                    pass

            clips_data.append({
                "id": c.id,
                "rank_title": c.rank_title,
                "title": c.rank_title,
                "emoji": c.emoji or "🔥",
                "start_time": c.start_time,
                "end_time": c.end_time,
                "virality_score": c.virality_score,
                "score": c.virality_score,
                "hook_sentence": c.hook_sentence,
                "stream_url": src_stream,
                "source_stream_url": src_stream,
                "source_video_path": v.source_path if v else None,
                "transcript": t_data,
                "video_title": v.title if v else None,
            })

        if not clips_data:
            raise HTTPException(status_code=400, detail="None of the specified clip IDs were found.")

        custom_job_id = f"job_custom_{uuid.uuid4().hex[:8]}"
        header_title = request.header_title.strip() if request.header_title else "RANKING VIRAL MOMENTS"

        job_data = {
            "id": custom_job_id,
            "batch_id": f"batch_custom_{uuid.uuid4().hex[:8]}",
            "url": clips_data[0].get("stream_url") or "",
            "status": "completed",
            "progress": f"Custom short with {len(clips_data)} clips ready for review.",
            "user_prompt": "Custom selection from Clips Repository",
            "num_clips": len(clips_data),
            "aspect_ratio": request.layout_mode,
            "layout_mode": request.layout_mode,
            "channel_handle": request.channel_handle,
            "captions_enabled": request.captions_enabled,
            "download_format": "720",
            "mode": "local",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "header_title": header_title,
            "candidates": clips_data,
            "source_stream_url": first_src_url,
            "final_video_url": None,
            "render_status": "idle",
            "render_error": None,
            "result": {
                "header_title": header_title,
                "candidates": clips_data,
                "highlights": clips_data,
                "shorts": clips_data,
                "source_stream_url": first_src_url,
                "source_video_url": clips_data[0].get("source_video_path"),
            },
        }

        async with jobs_lock:
            jobs_db[custom_job_id] = job_data
            _save_jobs_to_disk()

        return {
            "status": "success",
            "job_id": custom_job_id,
            "redirect_url": f"/review/{custom_job_id}",
            "clips_count": len(clips_data),
            "job": _enrich_job(job_data),
        }
    finally:
        db.close()


@app.post("/api/shorts/assemble-clips")
async def assemble_precut_clips(request: AssembleClipsRequest):
    """Assemble pre-cut individual video clips (e.g. 5x 1-min clips from YouTube) directly into a Ranking Short."""
    if len(request.clips) < 2:
        raise HTTPException(status_code=400, detail="Please provide at least 2 clips to create a ranking short.")

    job_id = f"job_assemble_{uuid.uuid4().hex[:8]}"
    header_title = (request.header_title or "RANKING TOP 5 MOMENTS").strip()
    layout_mode = request.layout_mode or "1:1"
    channel_handle = request.channel_handle
    captions_enabled = request.captions_enabled if request.captions_enabled is not None else True

    print(f"[server] Assembling {len(request.clips)} clips for job {job_id}...", flush=True)

    db = SessionLocal()
    candidates_data = []

    try:
        for idx, clip_item in enumerate(request.clips):
            clip_url = clip_item.url.strip()
            if not clip_url:
                continue

            print(f"[server] Processing clip #{idx + 1}: {clip_url}", flush=True)
            # 1. Download via yt-dlp (or resolve local file)
            try:
                local_path = download_youtube_local(clip_url, fmt="720", out_dir=OUTPUT_DIR)
            except Exception as e:
                print(f"[server] Error downloading clip {clip_url}: {e}", flush=True)
                raise HTTPException(status_code=400, detail=f"Failed to download/load clip #{idx + 1} ({clip_url}): {str(e)}")

            # 2. Probe video duration
            clip_duration = 60.0
            try:
                import subprocess
                probe_cmd = [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    local_path,
                ]
                dur_out = subprocess.check_output(probe_cmd, text=True).strip()
                if dur_out:
                    clip_duration = float(dur_out)
            except Exception as pe:
                print(f"[server] ffprobe warning on {local_path}: {pe}", flush=True)

            # 3. Transcribe with Whisper if captions enabled
            transcript_data = None
            transcript_json_path = None
            if captions_enabled:
                try:
                    transcript_data = transcribe_local(local_path)
                    from shorts_generator.local.transcriber import _transcript_json_cache_path
                    t_path = _transcript_json_cache_path(local_path)
                    if t_path.exists():
                        transcript_json_path = str(t_path)
                except Exception as te:
                    print(f"[server] Transcription warning for clip #{idx + 1}: {te}", flush=True)

            # 4. Resolve Title
            if clip_item.title and clip_item.title.strip():
                clip_title = clip_item.title.strip()
            else:
                stem = Path(local_path).stem.replace("source_", "").replace("_", " ").title()
                clip_title = stem if len(stem) > 3 else f"Moment #{idx + 1}"

            # Ensure stream URL
            clean_src = local_path.replace("\\", "/")
            if "output/" in clean_src:
                src_stream = f"/output/{clean_src.split('output/', 1)[1]}"
            else:
                src_stream = f"/output/{os.path.basename(clean_src)}"

            # 5. Persist to MySQL Video & ClipCandidate
            cand_id = f"clip_{idx + 1}"
            try:
                vid_rec = Video(
                    id=str(uuid.uuid4()),
                    youtube_url=clip_url,
                    title=clip_title,
                    duration=clip_duration,
                    source_path=local_path,
                    transcript_path=transcript_json_path,
                )
                db.add(vid_rec)
                db.commit()
                db.refresh(vid_rec)

                cand_rec = ClipCandidate(
                    id=str(uuid.uuid4()),
                    video_id=vid_rec.id,
                    rank_title=f"{idx + 1}. {clip_title}",
                    emoji="🔥",
                    start_time=0.0,
                    end_time=clip_duration,
                    virality_score=max(70, 98 - (idx * 2)),
                    hook_sentence=clip_title,
                )
                db.add(cand_rec)
                db.commit()
                db.refresh(cand_rec)
                cand_id = cand_rec.id
            except Exception as dbe:
                print(f"[server] Database persistence warning: {dbe}", flush=True)
                db.rollback()

            candidates_data.append({
                "id": cand_id,
                "rank_title": f"{idx + 1}. {clip_title}",
                "title": f"{idx + 1}. {clip_title}",
                "emoji": "🔥",
                "start_time": 0.0,
                "end_time": clip_duration,
                "virality_score": max(70, 98 - (idx * 2)),
                "score": max(70, 98 - (idx * 2)),
                "hook_sentence": clip_title,
                "stream_url": src_stream,
                "source_stream_url": src_stream,
                "source_video_path": local_path,
                "transcript": transcript_data,
                "video_title": clip_title,
            })

        if len(candidates_data) < 2:
            raise HTTPException(status_code=400, detail="At least 2 valid clips are required to assemble a ranking short.")

        # 6. Render the composite ranking short
        job_out_dir = os.path.join(OUTPUT_DIR, f"job_{job_id}")
        os.makedirs(job_out_dir, exist_ok=True)
        custom_mp4 = os.path.join(job_out_dir, "final_short.mp4")
        work_dir = os.path.join(job_out_dir, "assemble_render_work")

        print(f"[server] Rendering ranking short with {len(candidates_data)} clips...", flush=True)
        render_engine.render_ranking_short(
            source_video_path=candidates_data[0]["source_video_path"],
            transcript=candidates_data[0].get("transcript"),
            header_title=header_title,
            selected_clips=candidates_data,
            work_dir=work_dir,
            final_output_path=custom_mp4,
            layout_mode=layout_mode,
            channel_handle=channel_handle,
            captions_enabled=captions_enabled,
        )
        import shutil
        shutil.copyfile(custom_mp4, os.path.join(OUTPUT_DIR, "final_short.mp4"))

        # 7. Record in MySQL RenderedShort
        try:
            short_id = f"short_{job_id}"
            rs = db.query(RenderedShort).filter(RenderedShort.id == short_id).first()
            if not rs:
                rs = RenderedShort(
                    id=short_id,
                    header_title=header_title,
                    selected_clip_ids=[str(c.get("id")) for c in candidates_data],
                    output_file_path=custom_mp4,
                    assigned_channel=channel_handle,
                    is_uploaded=False,
                )
                db.add(rs)
            else:
                rs.header_title = header_title
                rs.selected_clip_ids = [str(c.get("id")) for c in candidates_data]
                rs.output_file_path = custom_mp4
                rs.assigned_channel = channel_handle
            db.commit()
        except Exception as dbe:
            print(f"[server] MySQL RenderedShort recording warning: {dbe}", flush=True)
            db.rollback()

        # 8. Save in memory jobs_db and disk
        job_data = {
            "id": job_id,
            "batch_id": f"batch_assemble_{uuid.uuid4().hex[:8]}",
            "url": candidates_data[0].get("stream_url") or "",
            "status": "completed",
            "progress": f"Assembled {len(candidates_data)} clips into ranking short.",
            "user_prompt": f"Pre-cut assemble ranking of {len(candidates_data)} clips",
            "num_clips": len(candidates_data),
            "aspect_ratio": layout_mode,
            "layout_mode": layout_mode,
            "channel_handle": channel_handle,
            "captions_enabled": captions_enabled,
            "download_format": "720",
            "mode": "local",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "header_title": header_title,
            "candidates": candidates_data,
            "source_stream_url": candidates_data[0].get("stream_url"),
            "final_video_url": f"/output/job_{job_id}/final_short.mp4",
            "render_status": "ready",
            "render_error": None,
            "result": {
                "header_title": header_title,
                "candidates": candidates_data,
                "highlights": candidates_data,
                "shorts": candidates_data,
                "source_stream_url": candidates_data[0].get("stream_url"),
                "source_video_url": candidates_data[0].get("source_video_path"),
            },
        }

        async with jobs_lock:
            jobs_db[job_id] = job_data
            _save_jobs_to_disk()

        return {
            "status": "success",
            "job_id": job_id,
            "redirect_url": f"/review/{job_id}",
            "final_video_url": f"/output/job_{job_id}/final_short.mp4",
            "clips_count": len(candidates_data),
            "job": _enrich_job(job_data),
        }

    finally:
        db.close()


@app.get("/api/channels")
def list_channels():
    """List configured YouTube channels."""
    db = SessionLocal()
    try:
        channels = db.query(YouTubeChannel).order_by(YouTubeChannel.created_at.desc()).all()
        return [
            {
                "id": ch.id,
                "channel_name": ch.channel_name,
                "credentials_json_path": ch.credentials_json_path,
                "created_at": ch.created_at.isoformat() if ch.created_at else None,
                "has_credentials": os.path.exists(ch.credentials_json_path),
            }
            for ch in channels
        ]
    finally:
        db.close()


@app.post("/api/channels")
def add_channel(request: ChannelCreateRequest):
    """Add/authenticate a new YouTube channel using Google OAuth JSON credentials."""
    db = SessionLocal()
    try:
        existing = db.query(YouTubeChannel).filter(YouTubeChannel.channel_name == request.channel_name.strip()).first()
        if existing:
            existing.credentials_json_path = request.credentials_json_path.strip()
            db.commit()
            db.refresh(existing)
            return {
                "status": "success",
                "message": f"Channel '{existing.channel_name}' credentials updated.",
                "channel": {
                    "id": existing.id,
                    "channel_name": existing.channel_name,
                    "credentials_json_path": existing.credentials_json_path,
                },
            }

        ch = YouTubeChannel(
            id=str(uuid.uuid4()),
            channel_name=request.channel_name.strip(),
            credentials_json_path=request.credentials_json_path.strip(),
        )
        db.add(ch)
        db.commit()
        db.refresh(ch)
        return {
            "status": "success",
            "message": f"Channel '{ch.channel_name}' added successfully.",
            "channel": {
                "id": ch.id,
                "channel_name": ch.channel_name,
                "credentials_json_path": ch.credentials_json_path,
            },
        }
    finally:
        db.close()


@app.get("/api/shorts")
def list_rendered_shorts():
    """List all generated final .mp4 shorts from RenderedShort database table."""
    db = SessionLocal()
    try:
        shorts = db.query(RenderedShort).order_by(RenderedShort.created_at.desc()).all()
        result = []
        for s in shorts:
            rel_url = None
            if s.output_file_path:
                clean = s.output_file_path.replace("\\", "/")
                if "output/" in clean:
                    rel_url = f"/output/{clean.split('output/', 1)[1]}"
                else:
                    rel_url = f"/output/{os.path.basename(clean)}"
            result.append({
                "id": s.id,
                "header_title": s.header_title,
                "selected_clip_ids": s.selected_clip_ids,
                "output_file_path": s.output_file_path,
                "video_url": rel_url,
                "assigned_channel": s.assigned_channel,
                "is_uploaded": s.is_uploaded,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            })
        return result
    finally:
        db.close()


@app.post("/api/shorts/batch-upload")
def batch_upload_shorts(request: BatchUploadRequest):
    """Accept array of shorts and trigger automated uploads via google-api-python-client."""
    from youtube_uploader import upload_short_to_youtube
    db = SessionLocal()
    results = []
    try:
        for item in request.uploads:
            short = db.query(RenderedShort).filter(RenderedShort.id == item.short_id).first()
            if not short:
                results.append({"short_id": item.short_id, "status": "error", "message": "Rendered short not found."})
                continue

            ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == item.channel_id).first()
            credentials_path = ch.credentials_json_path if ch else None

            try:
                upload_res = upload_short_to_youtube(
                    file_path=short.output_file_path,
                    title=item.title or short.header_title,
                    description=item.description or "",
                    tags=item.tags,
                    privacy_status=item.privacy_status or "public",
                    credentials_path=credentials_path,
                )
                short.is_uploaded = True
                if ch:
                    short.assigned_channel = ch.channel_name
                db.commit()
                results.append({
                    "short_id": item.short_id,
                    "status": "success",
                    "channel_name": ch.channel_name if ch else "Default Channel",
                    "upload_details": upload_res,
                })
            except Exception as exc:
                results.append({
                    "short_id": item.short_id,
                    "status": "error",
                    "message": str(exc),
                })
        return {"status": "success", "results": results}
    finally:
        db.close()


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    async with jobs_lock:
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail=f"Job with id '{job_id}' not found")
        del jobs_db[job_id]
        _save_jobs_to_disk()
    return {"message": f"Job {job_id} deleted successfully"}


@app.post("/api/jobs/clear")
async def clear_jobs():
    async with jobs_lock:
        jobs_db.clear()
        _save_jobs_to_disk()
    return {"message": "All jobs cleared successfully"}


@app.delete("/api/videos/{video_id}")
def delete_video(video_id: str):
    db = SessionLocal()
    try:
        v = db.query(Video).filter(Video.id == video_id).first()
        if not v:
            raise HTTPException(status_code=404, detail=f"Video '{video_id}' not found.")
        db.delete(v)
        db.commit()
        return {"status": "success", "message": f"Video '{video_id}' and its clips deleted."}
    finally:
        db.close()


@app.post("/api/clips/clear")
def clear_all_clips():
    db = SessionLocal()
    try:
        c_count = db.query(ClipCandidate).delete()
        v_count = db.query(Video).delete()
        db.commit()
        return {"status": "success", "message": f"Cleared {c_count} clips and {v_count} videos from database."}
    finally:
        db.close()


@app.delete("/api/shorts/{short_id}")
def delete_rendered_short(short_id: str):
    db = SessionLocal()
    try:
        s = db.query(RenderedShort).filter(RenderedShort.id == short_id).first()
        if not s:
            raise HTTPException(status_code=404, detail=f"Short '{short_id}' not found.")
        db.delete(s)
        db.commit()
        return {"status": "success", "message": f"Short '{short_id}' deleted."}
    finally:
        db.close()


@app.post("/api/shorts/clear")
def clear_all_rendered_shorts():
    db = SessionLocal()
    try:
        count = db.query(RenderedShort).delete()
        db.commit()
        return {"status": "success", "message": f"Cleared {count} rendered shorts from database."}
    finally:
        db.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
