"""FastAPI Backend Server for AI YouTube Shorts Studio.

Core Endpoints:
- Sources: Ingest YouTube URLs or local video files, track background transcription and highlight extraction.
- Clips: Query, filter, and non-destructively edit extracted clip highlights.
- Productions: Sequence multi-clip timelines, adjust layouts, and configure caption typography.
- Renders: Deterministic SHA-256 cached rendering engine for 9:16 Shorts delivery.
- Static mount /output: Streaming of generated MP4 clips with HTTP 206 Range support.
"""
import asyncio
import json
import os
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from celery import Celery
from fastapi import FastAPI, HTTPException, status, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import FileResponse, RedirectResponse, Response
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
    Clip,
    Transcript,
    TranscriptSegment,
    Production,
    ProductionClip,
    Render,
    init_db,
)
from sqlalchemy import func, or_
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
        os.makedirs(os.path.dirname(JOBS_DB_PATH), exist_ok=True)
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

        job_category = job.get("category") or result.get("category") or "Family Guy"

        if not v:
            transcript = result.get("transcript") or {}
            dur = transcript.get("duration", 0.0) if isinstance(transcript, dict) else 0.0
            src_url = result.get("source_video_url") or ""
            t_path = src_url.rsplit(".", 1)[0] + ".transcript.json" if src_url else None
            
            # Extract youtube_video_id
            yid = None
            if "v=" in yt_url:
                yid = yt_url.split("v=")[1].split("&")[0]
            elif "youtu.be/" in yt_url:
                yid = yt_url.split("youtu.be/")[1].split("?")[0]

            v = Video(
                id=vid_id,
                youtube_url=yt_url,
                youtube_video_id=yid,
                title=yt_title,
                duration=float(dur),
                category=job_category,
                source_path=src_url,
                transcript_path=t_path if (t_path and os.path.exists(t_path)) else None,
                user_prompt=job.get("user_prompt"),
                status="completed",
                current_stage="completed",
                progress="Clips discovered",
                completed_at=datetime.utcnow(),
            )
            db.add(v)
            db.flush()
        else:
            if yt_title and (not v.title or v.title == "RANKING VIRAL MOMENTS" or v.title.startswith("Video (")):
                v.title = yt_title
            if not v.source_path and result.get("source_video_url"):
                v.source_path = result.get("source_video_url")
            if job_category and (not v.category or v.category == "General"):
                v.category = job_category
            if job.get("user_prompt"):
                v.user_prompt = job.get("user_prompt")
            v.status = "completed"
            v.current_stage = "completed"
            v.progress = "Clips discovered"
            v.completed_at = datetime.utcnow()

        candidates = result.get("candidates", []) or result.get("highlights", []) or job.get("candidates", [])
        for idx, c in enumerate(candidates):
            raw_cid = str(c.get("id") or f"cand_{idx+1}")
            if not raw_cid.startswith(f"{vid_id}_"):
                cid = f"{vid_id}_{raw_cid}"
            else:
                cid = raw_cid
            c["id"] = cid

            raw_title = c.get("rank_title") or c.get("title") or f"Moment #{idx+1}"
            clip_cat = c.get("category") or job_category or "Family Guy"
            char_name = c.get("character") or c.get("character_name")
            start_s = float(c.get("start_time", 0.0))
            end_s = float(c.get("end_time", 0.0))
            score_val = int(c.get("virality_score") or c.get("score") or 90)
            emoji_val = c.get("emoji") or "🔥"
            hook_val = c.get("hook_sentence")
            reason_val = c.get("virality_reason") or c.get("reason")

            # 1. Update/Add legacy ClipCandidate
            existing_c = db.query(ClipCandidate).filter(ClipCandidate.id == cid).first()
            if not existing_c:
                existing_c = db.query(ClipCandidate).filter(
                    ClipCandidate.video_id == v.id,
                    ClipCandidate.rank_title == raw_title
                ).first()

            if not existing_c:
                clip_row = ClipCandidate(
                    id=cid,
                    video_id=v.id,
                    rank_title=raw_title,
                    emoji=emoji_val,
                    start_time=start_s,
                    end_time=end_s,
                    virality_score=score_val,
                    hook_sentence=hook_val,
                    category=clip_cat,
                    character_name=char_name,
                )
                db.add(clip_row)
            else:
                existing_c.rank_title = raw_title
                existing_c.start_time = start_s
                existing_c.end_time = end_s
                existing_c.emoji = emoji_val
                existing_c.virality_score = score_val
                existing_c.hook_sentence = hook_val
                existing_c.category = clip_cat
                if char_name:
                    existing_c.character_name = char_name

            # 2. Update/Add V2 Clip Entity
            existing_clip = db.query(Clip).filter(Clip.id == cid).first()
            if not existing_clip:
                tags_list = None
                raw_tags = c.get("tags")
                if isinstance(raw_tags, list):
                    tags_list = raw_tags
                elif isinstance(raw_tags, str) and raw_tags.strip():
                    tags_list = [t.strip() for t in raw_tags.split(",") if t.strip()]

                v2_clip = Clip(
                    id=cid,
                    source_id=v.id,
                    start_time=start_s,
                    end_time=end_s,
                    title=raw_title,
                    original_title=raw_title,
                    ai_score=score_val,
                    ai_reason=reason_val,
                    hook_sentence=hook_val,
                    emoji=emoji_val,
                    category=clip_cat,
                    character_name=char_name,
                    tags=tags_list,
                    is_favorite=False,
                    is_edited=False,
                    is_archived=False,
                )
                db.add(v2_clip)
            else:
                existing_clip.title = raw_title
                existing_clip.start_time = start_s
                existing_clip.end_time = end_s
                existing_clip.emoji = emoji_val
                existing_clip.ai_score = score_val
                existing_clip.hook_sentence = hook_val
                existing_clip.category = clip_cat
                if char_name:
                    existing_clip.character_name = char_name

        # 3. Save transcript if available and not yet in database
        transcript_data = result.get("transcript")
        if transcript_data and isinstance(transcript_data, dict):
            existing_tr = db.query(Transcript).filter(Transcript.source_id == v.id).first()
            if not existing_tr:
                try:
                    tr_id = f"trans_{uuid.uuid4().hex[:10]}"
                    tr = Transcript(
                        id=tr_id,
                        source_id=v.id,
                        language=transcript_data.get("language", "en"),
                        model="whisper-base",
                        version="1.0",
                        duration=float(transcript_data.get("duration", 0.0)),
                    )
                    db.add(tr)
                    db.flush()

                    for idx, s in enumerate(transcript_data.get("segments", [])):
                        seg = TranscriptSegment(
                            id=f"seg_{uuid.uuid4().hex[:12]}",
                            transcript_id=tr.id,
                            start_time=float(s.get("start", 0.0)),
                            end_time=float(s.get("end", 0.0)),
                            text=s.get("text", "").strip(),
                            words_json=s.get("words", []),
                        )
                        db.add(seg)
                except Exception as ex_tr:
                    print(f"[db] Warning saving transcript: {ex_tr}", flush=True)

        db.commit()
        print(f"[db] Successfully persisted video '{yt_title}' and {len(candidates)} reusable clips to MySQL.", flush=True)
    except Exception as e:
        db.rollback()
        print(f"[db] Warning: could not persist video to MySQL: {e}", flush=True)
    finally:
        db.close()


def _update_source_status(
    source_id: str,
    status: str,
    stage: Optional[str] = None,
    progress: Optional[str] = None,
    error: Optional[str] = None,
):
    """Synchronize source video status, stage, and progress across jobs_db and MySQL."""
    # 1. Update in-memory / disk jobs_db
    job = jobs_db.get(source_id)
    if job:
        job["status"] = status
        if stage is not None:
            job["stage"] = stage
            job["current_stage"] = stage
        if progress is not None:
            job["progress"] = progress
        if error is not None:
            job["error"] = error
        _save_jobs_to_disk()

    # 2. Update MySQL Video record
    db = SessionLocal()
    try:
        v = db.query(Video).filter(Video.id == source_id).first()
        if v:
            v.status = status
            if stage is not None:
                v.current_stage = stage
            if progress is not None:
                v.progress = progress
            if error is not None:
                v.error_message = error
            if status == "completed":
                v.completed_at = datetime.utcnow()
            db.commit()
    except Exception as e:
        print(f"[db] Warning syncing video status for {source_id}: {e}", flush=True)
    finally:
        db.close()


def _process_job_sync(job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = job["id"]
    job_out_dir = os.path.join(OUTPUT_DIR, f"job_{job_id}")
    os.makedirs(job_out_dir, exist_ok=True)

    print(f"[worker] Starting discovery for job {job_id} for URL: {job['url']}", flush=True)
    _update_source_status(job_id, status="processing", stage="downloading", progress="Downloading source video with yt-dlp...")
    num_clips = job.get("num_clips", 10)

    def _progress_cb(stage: str, msg: str):
        print(f"[job {job_id}] {stage}: {msg}", flush=True)
        _update_source_status(job_id, status="processing", stage=stage, progress=msg)

    result = generate_shorts(
        youtube_url=job["url"],
        num_clips=num_clips,
        aspect_ratio=job.get("aspect_ratio", "9:16"),
        download_format=job.get("download_format", "720"),
        mode=job.get("mode", "local"),
        out_dir=job_out_dir,
        user_prompt=job.get("user_prompt"),
        on_progress=_progress_cb,
    )
    result = _normalize_stream_urls(result, job_out_dir)

    # Source ingestion ends after clip discovery.
    # Video rendering is strictly on-demand.
    candidates = result.get("candidates", []) or result.get("highlights", [])

    # Persist to MySQL (Video, ClipCandidate, Clip, Transcript, TranscriptSegment)
    _save_video_and_clips_to_db(job, result)
    _update_source_status(job_id, status="completed", stage="completed", progress="Clips discovered and ready")

    print(f"[worker] Completed discovery for job {job_id}. Discovered {len(candidates)} reusable clips.", flush=True)
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
    job["progress"] = "Downloading source video..."
    job["stage"] = "downloading"
    job["started_at"] = datetime.now(timezone.utc).isoformat()
    _save_job_update(job_id, job)
    _update_source_status(job_id, status="processing", stage="downloading", progress="Downloading source video...")

    try:
        result = _process_job_sync(job)
        job["status"] = "completed"
        job["progress"] = "All clips generated successfully."
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        job["result"] = result
        job["error"] = None
        _save_job_update(job_id, job)
        _update_source_status(job_id, status="completed", stage="completed", progress="Clips discovered and ready")
        return {"status": "success", "job_id": job_id}
    except Exception as exc:
        print(f"[celery] Job {job_id} failed: {exc}", flush=True)
        job["status"] = "failed"
        job["progress"] = f"Failed: {exc}"
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        job["error"] = str(exc)
        _save_job_update(job_id, job)
        _update_source_status(job_id, status="failed", stage="failed", progress=f"Failed: {exc}", error=str(exc))
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
                job["progress"] = "Downloading source video..."
                job["stage"] = "downloading"
                job["started_at"] = datetime.now(timezone.utc).isoformat()
                _save_jobs_to_disk()
                _update_source_status(job_id, status="processing", stage="downloading", progress="Downloading source video...")

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
                    _update_source_status(job_id, status="completed", stage="completed", progress="Clips discovered and ready")
            except Exception as exc:
                print(f"[worker] Job {job_id} failed: {exc}", flush=True)
                async with jobs_lock:
                    job["status"] = "failed"
                    job["progress"] = f"Failed: {exc}"
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                    job["error"] = str(exc)
                    _save_jobs_to_disk()
                    _update_source_status(job_id, status="failed", stage="failed", progress=f"Failed: {exc}", error=str(exc))
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
    category: Optional[str] = Field("Family Guy", description="Show or category name, e.g. 'Family Guy', 'Modern Family'")
    num_clips: Optional[int] = Field(10, ge=1, le=10, description="Number of shorts to generate per video")
    aspect_ratio: Optional[str] = Field("9:16", description="Target aspect ratio")
    layout_mode: Optional[str] = Field("1:1", description="Layout mode: 1:1, 16:9, or 9:16")
    template_type: Optional[str] = Field("ranking", description="Template mode: 'ranking' or 'single_title'")
    font_family: Optional[str] = Field("minimal", description="Font typography: 'minimal' (Inter/clean sans) or 'anton' (bold impact)")
    transition_type: Optional[str] = Field("swoosh", description="Transition style: 'swoosh' or 'black_screen'")
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
    font_family: Optional[str] = Field("minimal", description="Font typography: 'minimal' or 'anton'")
    category: Optional[str] = None
    transition_type: Optional[str] = Field("swoosh", description="Transition style: 'swoosh' or 'black_screen'")
    channel_handle: Optional[str] = Field(None, description="Watermark channel handle")
    captions_enabled: Optional[bool] = Field(True, description="Enable or disable burned-in captions")
    countdown_order: Optional[bool] = Field(False, description="If true, rank numbers count down (5,4,3,2,1) instead of up (1,2,3,4,5)")


class ReanalyzeJobRequest(BaseModel):
    user_prompt: str = Field(..., min_length=1, description="AI prompt directive")
    num_clips: Optional[int] = Field(10, ge=1, le=10, description="Target number of moments")


class CustomBuildRequest(BaseModel):
    clip_ids: List[str] = Field(..., min_length=1, description="List of clip IDs to combine")
    header_title: Optional[str] = Field("RANKING VIRAL MOMENTS", description="Hook title")
    layout_mode: Optional[str] = Field("1:1", description="Layout mode: 1:1, 16:9, or 9:16")
    template_type: Optional[str] = Field("ranking", description="Template mode")
    font_family: Optional[str] = Field("minimal", description="Font typography: 'minimal' or 'anton'")
    category: Optional[str] = Field("Family Guy", description="Show/category name")
    channel_handle: Optional[str] = Field(None, description="Watermark handle")
    captions_enabled: Optional[bool] = Field(True, description="Enable captions")


class PrecutClipItem(BaseModel):
    url: str = Field(..., description="YouTube URL or local video file path")
    title: Optional[str] = Field(None, description="Optional custom rank title")
    display_rank: Optional[Any] = Field(None, description="Decoupled display rank (e.g. 5, 4, 3...)")
    category: Optional[str] = Field(None, description="Category or topic")
    character: Optional[str] = Field(None, description="Character name")


class ClipUpdateRequest(BaseModel):
    title: Optional[str] = None
    rank_title: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    category: Optional[str] = None
    character: Optional[str] = None
    tags: Optional[Any] = None
    virality_score: Optional[int] = None
    ai_score: Optional[int] = None
    emoji: Optional[str] = None
    hook_sentence: Optional[str] = None
    is_favorite: Optional[bool] = None
    is_archived: Optional[bool] = None


class JobCandidatesUpdateRequest(BaseModel):
    candidates: List[Dict[str, Any]]
    header_title: Optional[str] = None
    layout_mode: Optional[str] = None
    transition_type: Optional[str] = None
    channel_handle: Optional[str] = None
    captions_enabled: Optional[bool] = None


class AssembleClipsRequest(BaseModel):
    clips: List[PrecutClipItem] = Field(..., min_length=2, max_length=15, description="List of pre-cut clips to assemble")
    header_title: Optional[str] = Field("RANKING TOP 5 MOMENTS", description="Top hook banner title")
    layout_mode: Optional[str] = Field("1:1", description="Layout mode: 1:1, 16:9, or 9:16")
    category: Optional[str] = Field("Family Guy", description="Show/category name")
    font_family: Optional[str] = Field("minimal", description="Font typography: 'minimal' or 'anton'")
    channel_handle: Optional[str] = Field(None, description="Watermark channel handle")
    captions_enabled: Optional[bool] = Field(True, description="Enable or disable burned-in captions")
    countdown_order: Optional[bool] = Field(False, description="If true, rank numbers count down (5,4,3,2,1)")
    transition_type: Optional[str] = Field("swoosh", description="Transition style: 'swoosh' or 'black_screen'")


# Request Models
class SourceCreateRequest(BaseModel):
    urls: Optional[List[str]] = None
    url: Optional[str] = None
    youtube_url: Optional[str] = None
    user_prompt: Optional[str] = None
    category: Optional[str] = "Family Guy"
    num_clips: Optional[int] = 10
    target_duration: Optional[str] = None
    layout_mode: Optional[str] = None


def parse_timestamp_str(t_val) -> float:
    """Parse seconds float, int, or HH:MM:SS / MM:SS string into seconds float."""
    if t_val is None:
        return 0.0
    if isinstance(t_val, (int, float)):
        return float(t_val)
    if not isinstance(t_val, str):
        return 0.0
    t_val = t_val.strip()
    if not t_val:
        return 0.0
    if ":" in t_val:
        parts = t_val.split(":")
        try:
            if len(parts) == 3:
                h, m, s = parts
                return float(h) * 3600 + float(m) * 60 + float(s)
            elif len(parts) == 2:
                m, s = parts
                return float(m) * 60 + float(s)
        except ValueError:
            return 0.0
    try:
        return float(t_val)
    except ValueError:
        return 0.0


class ClipPatchRequest(BaseModel):
    title: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    is_favorite: Optional[bool] = None
    is_archived: Optional[bool] = None
    emoji: Optional[str] = None
    category: Optional[str] = None
    character_name: Optional[str] = None
    tags: Optional[List[str]] = None


class ClipBulkEditItem(BaseModel):
    id: str
    title: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    is_favorite: Optional[bool] = None
    is_archived: Optional[bool] = None


class ClipBulkEditRequest(BaseModel):
    updates: List[ClipBulkEditItem]


class ClipBulkFavoriteRequest(BaseModel):
    clip_ids: List[str]
    is_favorite: bool = True


class ClipBulkDeleteRequest(BaseModel):
    clip_ids: List[str]


class ProductionClipInput(BaseModel):
    clip_id: str
    custom_title: Optional[str] = None
    start_override: Optional[float] = None
    end_override: Optional[float] = None
    position: Optional[int] = None


class ProductionCreateRequest(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    clip_ids: List[str] = Field(default_factory=list)
    template: Optional[str] = "ranking"
    aspect_ratio: Optional[str] = "9:16"
    layout_mode: Optional[str] = "1:1"
    max_duration: Optional[float] = 60.0
    channel_handle: Optional[str] = None
    transition_type: Optional[str] = "swoosh"
    countdown_order: Optional[bool] = False
    font_family: Optional[str] = "minimal"


class ProductionPatchRequest(BaseModel):
    name: Optional[str] = None
    template: Optional[str] = None
    aspect_ratio: Optional[str] = None
    layout_mode: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    hashtags: Optional[List[str]] = None
    caption_settings: Optional[Dict[str, Any]] = None
    max_duration: Optional[float] = None
    transition_type: Optional[str] = None
    countdown_order: Optional[bool] = None
    font_family: Optional[str] = None
    channel_handle: Optional[str] = None
    clips: Optional[List[ProductionClipInput]] = None


class MetadataGenerateRequest(BaseModel):
    focus_topic: Optional[str] = None


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
    j.setdefault("font_family", "minimal")
    j.setdefault("transition_type", "swoosh")

    cat = j.get("category")
    if not cat:
        title = str(j.get("header_title") or j.get("video_title") or j.get("url") or "").lower()
        cat = "Modern Family" if "modern family" in title else "Family Guy"
    j["category"] = cat

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

    # Ensure all candidates have stream_url, source_stream_url, and category set
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

                if not c.get("category") or c.get("category") == "General":
                    c["category"] = cat

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


# ==============================================================================
# REST Endpoints (Sources, Clips, Productions, Renders, Dashboard)
# ==============================================================================

@app.get("/api/dashboard/stats")
def get_dashboard_stats():
    """Retrieve studio overview metrics for the main Dashboard."""
    db = SessionLocal()
    try:
        total_sources = db.query(Video).count()
        processing_sources = db.query(Video).filter(Video.status.in_(["queued", "downloading", "transcribing", "analyzing"])).count()
        
        total_clips = db.query(Clip).filter(Clip.is_archived == False).count()
        favorite_clips = db.query(Clip).filter(Clip.is_favorite == True, Clip.is_archived == False).count()
        edited_clips = db.query(Clip).filter(Clip.is_edited == True, Clip.is_archived == False).count()
        
        total_productions = db.query(Production).count()
        total_renders = db.query(Render).filter(Render.status == "completed").count()

        recent_sources = db.query(Video).order_by(Video.created_at.desc()).limit(5).all()
        recent_prods = db.query(Production).order_by(Production.created_at.desc()).limit(5).all()

        return {
            "total_sources": total_sources,
            "processing_sources": processing_sources,
            "total_clips": total_clips,
            "favorite_clips": favorite_clips,
            "edited_clips": edited_clips,
            "total_productions": total_productions,
            "total_renders": total_renders,
            "recent_sources": [
                {
                    "id": s.id,
                    "title": s.title or f"Source ({s.id[:8]})",
                    "status": s.status or "completed",
                    "progress": s.progress or "Ready",
                    "clips_count": len(s.clips),
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in recent_sources
            ],
            "recent_productions": [
                {
                    "id": p.id,
                    "name": p.name,
                    "status": p.status,
                    "template": p.template,
                    "clip_count": len(p.clips),
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in recent_prods
            ],
        }
    finally:
        db.close()


@app.get("/api/sources")
def list_sources():
    """List all source videos with processing status, stage, duration, and clips discovered count."""
    db = SessionLocal()
    try:
        sources = db.query(Video).order_by(Video.created_at.desc()).all()
        result = []
        for s in sources:
            clips_count = db.query(Clip).filter(Clip.source_id == s.id, Clip.is_archived == False).count()
            if clips_count == 0:
                clips_count = db.query(ClipCandidate).filter(ClipCandidate.video_id == s.id).count()

            stream_url = to_stream_url(s.source_path)
            thumb = s.thumbnail_url
            if not thumb and s.youtube_video_id:
                thumb = f"https://img.youtube.com/vi/{s.youtube_video_id}/hqdefault.jpg"
            if not thumb:
                thumb = f"/api/sources/{s.id}/thumbnail"

            job = jobs_db.get(s.id)
            current_status = s.status or "completed"
            current_stage = s.current_stage or current_status
            progress = s.progress or "Ready"
            error_message = s.error_message

            if job:
                j_status = job.get("status")
                if j_status:
                    current_status = j_status
                if job.get("stage"):
                    current_stage = job.get("stage")
                elif job.get("current_stage"):
                    current_stage = job.get("current_stage")
                if job.get("progress"):
                    progress = job.get("progress")
                if job.get("error"):
                    error_message = job.get("error")

            result.append({
                "id": s.id,
                "youtube_url": s.youtube_url,
                "youtube_video_id": s.youtube_video_id,
                "title": s.title or f"Source ({s.id[:8]})",
                "duration": s.duration,
                "category": s.category or "Family Guy",
                "source_path": s.source_path,
                "stream_url": stream_url,
                "thumbnail_url": thumb,
                "status": current_status,
                "current_stage": current_stage,
                "progress": progress,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                "error_message": error_message,
                "clips_count": clips_count,
                "user_prompt": s.user_prompt or (job.get("user_prompt") if job else None),
                "created_at": s.created_at.isoformat() if s.created_at else None,
            })
        return result
    finally:
        db.close()


@app.post("/api/sources", status_code=status.HTTP_202_ACCEPTED)
@app.post("/api/sources/batch", status_code=status.HTTP_202_ACCEPTED)
async def create_sources(request: SourceCreateRequest):
    """Add one or more YouTube URLs as sources to process through AI discovery."""
    batch_id = f"batch_{uuid.uuid4().hex[:8]}"
    created_sources = []
    category = request.category.strip() if (request.category and request.category.strip()) else "Family Guy"

    raw_urls = []
    if request.urls:
        raw_urls.extend(request.urls)
    if request.url:
        raw_urls.append(request.url)
    if request.youtube_url:
        raw_urls.append(request.youtube_url)

    urls_to_process = []
    seen = set()
    for u in raw_urls:
        if isinstance(u, str):
            for part in u.split("\n"):
                part = part.strip()
                if part and part not in seen:
                    seen.add(part)
                    urls_to_process.append(part)

    if not urls_to_process:
        raise HTTPException(status_code=400, detail="Please provide at least one valid YouTube URL.")

    db = SessionLocal()
    try:
        for url in urls_to_process:
            cleaned_url = url.strip()
            if not cleaned_url:
                continue

            yid = None
            if "v=" in cleaned_url:
                yid = cleaned_url.split("v=")[1].split("&")[0]
            elif "youtu.be/" in cleaned_url:
                yid = cleaned_url.split("youtu.be/")[1].split("?")[0]

            existing = None
            if yid:
                existing = db.query(Video).filter(Video.youtube_video_id == yid).first()
            if not existing:
                existing = db.query(Video).filter(Video.youtube_url == cleaned_url).first()

            if existing:
                # If already queued or processing, avoid creating duplicate
                if existing.status in ("queued", "processing", "downloading", "transcribing", "analyzing"):
                    created_sources.append({
                        "id": existing.id,
                        "title": existing.title,
                        "status": existing.status,
                        "message": "Source is already being processed",
                        "clips_count": 0,
                    })
                    continue

                if existing.status == "completed":
                    requested_prompt = request.user_prompt.strip() if request.user_prompt else None
                    # Only reuse existing source if no custom prompt was specified OR if the prompt matches
                    if not requested_prompt or (existing.user_prompt and existing.user_prompt.strip() == requested_prompt):
                        clips_count = db.query(Clip).filter(Clip.source_id == existing.id).count()
                        if clips_count > 0:
                            created_sources.append({
                                "id": existing.id,
                                "title": existing.title,
                                "status": "completed",
                                "message": "Reusing existing source",
                                "clips_count": clips_count,
                            })
                            continue

            src_id = f"job_{uuid.uuid4().hex[:8]}"
            source_rec = Video(
                id=src_id,
                youtube_url=cleaned_url,
                youtube_video_id=yid,
                title=f"Source ({yid or src_id[:8]})",
                category=category,
                user_prompt=request.user_prompt.strip() if request.user_prompt else None,
                status="queued",
                current_stage="queued",
                progress="Queued for AI clip discovery...",
                started_at=datetime.utcnow(),
            )
            db.add(source_rec)
            db.commit()

            job_data = {
                "id": src_id,
                "batch_id": batch_id,
                "url": cleaned_url,
                "status": "queued",
                "progress": "Queued for AI clip discovery...",
                "user_prompt": request.user_prompt.strip() if request.user_prompt else None,
                "category": category,
                "num_clips": request.num_clips or 10,
                "aspect_ratio": "9:16",
                "layout_mode": "1:1",
                "mode": "local",
                "download_format": "720",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            async with jobs_lock:
                jobs_db[src_id] = job_data
                _save_jobs_to_disk()

            try:
                process_video_task.delay(src_id, job_data)
            except Exception as e:
                print(f"[server] Celery dispatch fallback: {e}", flush=True)
                job_queue.put_nowait(src_id)

            created_sources.append({
                "id": src_id,
                "title": source_rec.title,
                "status": "queued",
                "clips_count": 0,
            })

        return {
            "status": "success",
            "batch_id": batch_id,
            "count": len(created_sources),
            "sources": created_sources,
        }
    finally:
        db.close()


@app.get("/api/sources/{source_id}")
def get_source_detail(source_id: str):
    """Retrieve full source details, processing stages, logs, and clip summary."""
    db = SessionLocal()
    try:
        s = db.query(Video).filter(Video.id == source_id).first()
        if not s:
            job = jobs_db.get(source_id)
            if not job:
                raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
            return {
                "id": job["id"],
                "youtube_url": job["url"],
                "youtube_video_id": None,
                "title": job.get("video_title") or job.get("header_title") or f"Job ({job['id'][:8]})",
                "duration": 0.0,
                "category": job.get("category", "Family Guy"),
                "status": job.get("status", "queued"),
                "current_stage": job.get("status", "queued"),
                "progress": job.get("progress", ""),
                "started_at": job.get("started_at"),
                "completed_at": job.get("completed_at"),
                "error_message": job.get("error"),
                "clips_count": len(job.get("candidates") or []),
                "stream_url": job.get("source_stream_url"),
                "thumbnail_url": None,
                "has_transcript": False,
                "user_prompt": job.get("user_prompt"),
            }

        clips = db.query(Clip).filter(Clip.source_id == s.id, Clip.is_archived == False).all()
        has_transcript = db.query(Transcript).filter(Transcript.source_id == s.id).count() > 0

        thumb = s.thumbnail_url
        if not thumb and s.youtube_video_id:
            thumb = f"https://img.youtube.com/vi/{s.youtube_video_id}/hqdefault.jpg"
        if not thumb:
            thumb = f"/api/sources/{s.id}/thumbnail"

        job = jobs_db.get(s.id)
        current_status = s.status or "completed"
        current_stage = s.current_stage or current_status
        progress = s.progress or "Ready"
        error_message = s.error_message

        if job:
            j_status = job.get("status")
            if j_status:
                current_status = j_status
            if job.get("stage"):
                current_stage = job.get("stage")
            elif job.get("current_stage"):
                current_stage = job.get("current_stage")
            if job.get("progress"):
                progress = job.get("progress")
            if job.get("error"):
                error_message = job.get("error")

        return {
            "id": s.id,
            "youtube_url": s.youtube_url,
            "youtube_video_id": s.youtube_video_id,
            "title": s.title or f"Source ({s.id[:8]})",
            "duration": s.duration,
            "category": s.category or "Family Guy",
            "source_path": s.source_path,
            "stream_url": to_stream_url(s.source_path),
            "thumbnail_url": thumb,
            "status": current_status,
            "current_stage": current_stage,
            "progress": progress,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "error_message": error_message,
            "clips_count": len(clips),
            "has_transcript": has_transcript,
            "user_prompt": s.user_prompt or (job.get("user_prompt") if job else None),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
    finally:
        db.close()


@app.get("/api/sources/{source_id}/thumbnail")
def get_source_thumbnail(source_id: str):
    """Serve or generate on-demand lightweight JPEG thumbnail for a source video."""
    thumbs_dir = os.path.join(OUTPUT_DIR, "thumbnails")
    os.makedirs(thumbs_dir, exist_ok=True)
    thumb_path = os.path.join(thumbs_dir, f"source_{source_id}.jpg")

    if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
        return FileResponse(thumb_path, media_type="image/jpeg")

    db = SessionLocal()
    try:
        s = db.query(Video).filter(Video.id == source_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="Source not found")
        if s.thumbnail_url and s.thumbnail_url.startswith("http"):
            return RedirectResponse(s.thumbnail_url)
        if s.youtube_video_id:
            return RedirectResponse(f"https://img.youtube.com/vi/{s.youtube_video_id}/hqdefault.jpg")
        if s.source_path and os.path.exists(s.source_path):
            import subprocess
            cmd = ["ffmpeg", "-y", "-ss", "1.0", "-i", s.source_path, "-frames:v", "1", "-q:v", "4", "-vf", "scale=480:-1", thumb_path]
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=10)
                if os.path.exists(thumb_path):
                    return FileResponse(thumb_path, media_type="image/jpeg")
            except Exception as e:
                print(f"[source_thumb] error: {e}", flush=True)

        svg = """<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" fill="#090d16"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#475569" font-family="sans-serif" font-weight="600" font-size="18">Video Source</text></svg>"""
        return Response(content=svg, media_type="image/svg+xml")
    finally:
        db.close()


@app.delete("/api/sources/{source_id}")
def delete_source(source_id: str):
    """Delete a source video and its associated clips and transcripts."""
    db = SessionLocal()
    try:
        s = db.query(Video).filter(Video.id == source_id).first()
        if s:
            db.delete(s)
            db.commit()
        if source_id in jobs_db:
            del jobs_db[source_id]
            _save_jobs_to_disk()
        return {"status": "success", "deleted_source_id": source_id}
    finally:
        db.close()


@app.post("/api/sources/{source_id}/retry")
def retry_source(source_id: str):
    """Retry a failed source job."""
    db = SessionLocal()
    try:
        s = db.query(Video).filter(Video.id == source_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="Source not found")
        s.status = "queued"
        s.current_stage = "queued"
        s.progress = "Retrying source processing..."
        s.error_message = None
        s.started_at = datetime.utcnow()
        db.commit()

        job_data = {
            "id": s.id,
            "batch_id": f"retry_{uuid.uuid4().hex[:6]}",
            "url": s.youtube_url,
            "status": "queued",
            "progress": "Retrying source processing...",
            "category": s.category or "Family Guy",
            "num_clips": 10,
            "aspect_ratio": "9:16",
            "layout_mode": "1:1",
            "mode": "local",
            "download_format": "720",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        jobs_db[s.id] = job_data
        _save_jobs_to_disk()

        try:
            process_video_task.delay(s.id, job_data)
        except Exception:
            job_queue.put_nowait(s.id)

        return {"status": "success", "message": f"Source {source_id} requeued."}
    finally:
        db.close()


@app.post("/api/sources/{source_id}/cancel")
def cancel_source(source_id: str):
    """Cancel a pending source job."""
    db = SessionLocal()
    try:
        s = db.query(Video).filter(Video.id == source_id).first()
        if s:
            s.status = "cancelled"
            s.progress = "Processing cancelled by user."
            db.commit()
        if source_id in jobs_db:
            jobs_db[source_id]["status"] = "cancelled"
            jobs_db[source_id]["progress"] = "Processing cancelled by user."
            _save_jobs_to_disk()
        return {"status": "success", "message": f"Source {source_id} cancelled."}
    finally:
        db.close()


def _auto_transcribe_audio_slice(
    db,
    src: Video,
    clip_start: float,
    clip_end: float,
) -> Optional[Dict[str, Any]]:
    """Extract audio slice and transcribe using local Whisper, saving segments to MySQL Transcript."""
    if not src or not src.source_path or not os.path.exists(src.source_path):
        return None

    try:
        actual_start = max(0.0, float(clip_start) - 0.2)
        actual_end = float(clip_end) + 0.2
        duration = actual_end - actual_start
        if duration <= 0:
            return None

        temp_wav = os.path.join(OUTPUT_DIR, f"temp_slice_{uuid.uuid4().hex[:8]}.wav")
        cmd = [
            "ffmpeg", "-y", "-ss", f"{actual_start:.3f}", "-to", f"{actual_end:.3f}",
            "-i", src.source_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            temp_wav,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        try:
            whisper_res = transcribe_local(temp_wav)
        finally:
            if os.path.exists(temp_wav):
                try:
                    os.remove(temp_wav)
                except OSError:
                    pass

        raw_segs = whisper_res.get("segments", [])
        if not raw_segs:
            return None

        offset_segs = []
        for s in raw_segs:
            s_start = round(float(s.get("start", 0.0)) + actual_start, 3)
            s_end = round(float(s.get("end", 0.0)) + actual_start, 3)
            raw_words = s.get("words", [])
            offset_words = []
            for w in raw_words:
                w_start = round(float(w.get("start", 0.0)) + actual_start, 3)
                w_end = round(float(w.get("end", 0.0)) + actual_start, 3)
                offset_words.append({
                    "word": w.get("word", ""),
                    "start": w_start,
                    "end": w_end,
                    "probability": w.get("probability", 1.0),
                })
            offset_segs.append({
                "start": s_start,
                "end": s_end,
                "start_time": s_start,
                "end_time": s_end,
                "text": s.get("text", "").strip(),
                "words": offset_words,
            })

        tr = db.query(Transcript).filter(Transcript.source_id == src.id).first()
        if not tr:
            tr = Transcript(
                id=f"trans_{uuid.uuid4().hex[:10]}",
                source_id=src.id,
                language=whisper_res.get("language", "en"),
                model="whisper-base-slice",
                version="1.0",
                duration=float(src.duration or actual_end),
            )
            db.add(tr)
            db.flush()

        for seg_data in offset_segs:
            # Check if this segment already exists to prevent duplicate rows
            existing_seg = any(abs(s.start_time - seg_data["start"]) < 0.2 for s in tr.segments) if tr.segments else False
            if not existing_seg:
                seg_rec = TranscriptSegment(
                    id=f"seg_{uuid.uuid4().hex[:12]}",
                    transcript_id=tr.id,
                    start_time=seg_data["start"],
                    end_time=seg_data["end"],
                    text=seg_data["text"],
                    words_json=seg_data["words"],
                )
                db.add(seg_rec)

        db.commit()
        print(f"[transcript] Successfully auto-transcribed {len(offset_segs)} segments for clip [{clip_start}-{clip_end}s] in source {src.id}", flush=True)

        return {
            "language": tr.language or "en",
            "duration": tr.duration,
            "segments": offset_segs,
        }
    except Exception as e:
        print(f"[transcript] Error auto-transcribing audio slice for {src.id}: {e}", flush=True)
        return None


def _auto_transcribe_full_source(db, src: Video) -> Optional[Dict[str, Any]]:
    """Transcribe an entire source video file using local Whisper and persist to MySQL."""
    if not src or not src.source_path or not os.path.exists(src.source_path):
        return None
    try:
        whisper_res = transcribe_local(src.source_path)
        raw_segs = whisper_res.get("segments", [])
        if not raw_segs:
            return None

        tr = db.query(Transcript).filter(Transcript.source_id == src.id).first()
        if not tr:
            tr = Transcript(
                id=f"trans_{uuid.uuid4().hex[:10]}",
                source_id=src.id,
                language=whisper_res.get("language", "en"),
                model="whisper-base",
                version="1.0",
                duration=float(whisper_res.get("duration") or src.duration or 0.0),
            )
            db.add(tr)
            db.flush()

        for s in raw_segs:
            seg_rec = TranscriptSegment(
                id=f"seg_{uuid.uuid4().hex[:12]}",
                transcript_id=tr.id,
                start_time=float(s.get("start", 0.0)),
                end_time=float(s.get("end", 0.0)),
                text=s.get("text", "").strip(),
                words_json=s.get("words", []),
            )
            db.add(seg_rec)

        from shorts_generator.local.transcriber import _transcript_json_cache_path
        cache_p = _transcript_json_cache_path(src.source_path)
        if cache_p.exists():
            src.transcript_path = str(cache_p)
        src.status = "completed"

        db.commit()
        print(f"[transcript] Successfully auto-transcribed full source {src.id} ({len(raw_segs)} segments)", flush=True)

        return {
            "language": tr.language or "en",
            "duration": tr.duration,
            "segments": [
                {
                    "start": float(s.get("start", 0.0)),
                    "end": float(s.get("end", 0.0)),
                    "start_time": float(s.get("start", 0.0)),
                    "end_time": float(s.get("end", 0.0)),
                    "text": s.get("text", "").strip(),
                    "words": s.get("words", []),
                }
                for s in raw_segs
            ],
        }
    except Exception as e:
        print(f"[transcript] Error auto-transcribing full source {src.id}: {e}", flush=True)
        return None


def _resolve_source_transcript(
    db,
    source_id: Optional[str],
    src: Optional[Video] = None,
    clip_start: Optional[float] = None,
    clip_end: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Retrieve transcript with word-level timing from DB Transcript, disk cache, or auto-transcribe on the fly."""
    if not source_id and src:
        source_id = src.id
    if not source_id:
        return None

    # 1. Query MySQL DB
    try:
        tr = db.query(Transcript).filter(Transcript.source_id == source_id).first()
        if tr and tr.segments:
            # If clip boundaries specified, verify if DB segments overlap with this clip
            all_segs = [
                {
                    "start": seg.start_time,
                    "end": seg.end_time,
                    "start_time": seg.start_time,
                    "end_time": seg.end_time,
                    "text": seg.text or "",
                    "words": seg.words_json if isinstance(seg.words_json, list) else (json.loads(seg.words_json) if seg.words_json else []),
                }
                for seg in tr.segments
            ]
            if clip_start is not None and clip_end is not None:
                has_overlap = any(s["end"] > clip_start and s["start"] < clip_end for s in all_segs)
                if has_overlap:
                    return {
                        "language": tr.language or "en",
                        "duration": tr.duration or (src.duration if src else 0.0),
                        "segments": all_segs,
                    }
                # If no overlap exists in DB for this specific slice, let auto-transcribe slice handle it below
            else:
                return {
                    "language": tr.language or "en",
                    "duration": tr.duration or (src.duration if src else 0.0),
                    "segments": all_segs,
                }
    except Exception as e:
        print(f"[transcript] DB lookup error for {source_id}: {e}", flush=True)

    # 2. Check disk transcript_path on src
    if src and src.transcript_path and os.path.exists(src.transcript_path):
        try:
            with open(src.transcript_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    # 3. Check jobs_db
    if source_id in jobs_db:
        job = jobs_db[source_id]
        res = job.get("result") or {}
        t = res.get("transcript") or job.get("transcript")
        if t:
            return t
        tp = job.get("transcript_path")
        if tp and os.path.exists(tp):
            try:
                with open(tp, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

    # 4. Fallback search by filename stem in OUTPUT_DIR
    if src and src.source_path:
        stem = Path(src.source_path).stem
        cand = os.path.join(OUTPUT_DIR, f"{stem}.transcript.json")
        if os.path.exists(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

    # 5. AUTO-TRANSCRIBE ON THE FLY for manual MP4 clips / manual cuts without Whisper
    target_src = src
    if not target_src and source_id:
        target_src = db.query(Video).filter(Video.id == source_id).first()

    if target_src and target_src.source_path and os.path.exists(target_src.source_path):
        if clip_start is not None and clip_end is not None and clip_end > clip_start:
            print(f"[transcript] Auto-transcribing missing clip slice [{clip_start}-{clip_end}s] for source {target_src.id}...", flush=True)
            return _auto_transcribe_audio_slice(db, target_src, clip_start, clip_end)
        else:
            print(f"[transcript] Auto-transcribing missing full source {target_src.id}...", flush=True)
            return _auto_transcribe_full_source(db, target_src)

    return None


@app.post("/api/sources/{source_id}/rediscover")
async def rediscover_source_clips(source_id: str, request: ReanalyzeJobRequest):
    """Re-analyze an existing source video using a custom AI prompt (e.g. 'only stewie savage moments').
    Reuses existing transcript to instantly discover and update clips without re-downloading.
    """
    clean_prompt = request.user_prompt.strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="Prompt directive cannot be empty.")

    db = SessionLocal()
    try:
        s = db.query(Video).filter(Video.id == source_id).first()
        transcript_data = None

        # 1. Fetch transcript from DB
        tr = db.query(Transcript).filter(Transcript.source_id == source_id).first()
        if tr and tr.segments:
            transcript_data = {
                "language": tr.language or "en",
                "duration": tr.duration or (s.duration if s else 0.0),
                "segments": [
                    {
                        "start": seg.start_time,
                        "end": seg.end_time,
                        "start_time": seg.start_time,
                        "end_time": seg.end_time,
                        "text": seg.text,
                        "words": seg.words_json or [],
                    }
                    for seg in tr.segments
                ]
            }

        # 2. If not in DB, check source file or jobs_db
        if not transcript_data and s and s.transcript_path and os.path.exists(s.transcript_path):
            try:
                with open(s.transcript_path, "r", encoding="utf-8") as f:
                    transcript_data = json.load(f)
            except Exception:
                pass

        if not transcript_data and source_id in jobs_db:
            job = jobs_db[source_id]
            res = job.get("result") or {}
            transcript_data = res.get("transcript") or job.get("transcript")

        if not transcript_data or not transcript_data.get("segments"):
            raise HTTPException(
                status_code=400,
                detail="Source does not have an available transcript yet. Please wait for initial transcription to finish."
            )

        from shorts_generator.highlights import get_highlights, call_muapi_llm
        from shorts_generator.local.llm import call_local_llm
        from shorts_generator.config import MUAPI_API_KEY

        llm_fn = call_local_llm if not MUAPI_API_KEY else call_muapi_llm
        num_clips = request.num_clips or 10

        try:
            highlights_result = get_highlights(
                transcript=transcript_data,
                num_clips=num_clips,
                llm_fn=llm_fn,
                user_prompt=clean_prompt,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"AI clip discovery failed: {str(exc)}")

        candidates = highlights_result.get("candidates", []) or highlights_result.get("highlights", [])
        if not candidates:
            raise HTTPException(status_code=500, detail="AI discovery returned no candidate clips.")

        # Update Video record with new user_prompt
        if s:
            s.user_prompt = clean_prompt
            db.commit()

        # Update in-memory / disk job if present
        async with jobs_lock:
            if source_id in jobs_db:
                jobs_db[source_id]["user_prompt"] = clean_prompt
                jobs_db[source_id]["candidates"] = candidates
                if "result" in jobs_db[source_id] and isinstance(jobs_db[source_id]["result"], dict):
                    jobs_db[source_id]["result"]["user_prompt"] = clean_prompt
                    jobs_db[source_id]["result"]["candidates"] = candidates
                _save_jobs_to_disk()

        # Update / add clips to DB
        fake_job = {
            "id": source_id,
            "url": s.youtube_url if s else "",
            "category": s.category if s else "Family Guy",
            "user_prompt": clean_prompt,
            "num_clips": num_clips,
        }
        fake_result = {
            "video_title": s.title if s else "Source",
            "source_video_url": s.source_path if s else None,
            "candidates": candidates,
            "highlights": candidates,
            "transcript": transcript_data,
        }
        _save_video_and_clips_to_db(fake_job, fake_result)

        return {
            "status": "success",
            "message": f"Successfully re-discovered {len(candidates)} clips matching '{clean_prompt}'.",
            "user_prompt": clean_prompt,
            "candidates_count": len(candidates),
        }
    finally:
        db.close()


@app.get("/api/sources/{source_id}/transcript")
def get_source_transcript(source_id: str):
    """Fetch transcript segments with word-level timing for a source video."""
    db = SessionLocal()
    try:
        tr = db.query(Transcript).filter(Transcript.source_id == source_id).first()
        if not tr:
            v = db.query(Video).filter(Video.id == source_id).first()
            transcript_file = v.transcript_path if (v and v.transcript_path) else None
            if not transcript_file and source_id in jobs_db:
                transcript_file = jobs_db[source_id].get("transcript_path")

            if transcript_file and os.path.exists(transcript_file):
                try:
                    with open(transcript_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict) and "segments" in data and isinstance(data["segments"], list):
                            for s in data["segments"]:
                                if isinstance(s, dict):
                                    if "start_time" not in s and "start" in s:
                                        s["start_time"] = s["start"]
                                    if "end_time" not in s and "end" in s:
                                        s["end_time"] = s["end"]
                                    if "start" not in s and "start_time" in s:
                                        s["start"] = s["start_time"]
                                    if "end" not in s and "end_time" in s:
                                        s["end"] = s["end_time"]
                        return data
                except Exception:
                    pass
            return {"language": "en", "duration": 0.0, "segments": []}

        segments = [
            {
                "id": seg.id,
                "start": seg.start_time,
                "end": seg.end_time,
                "start_time": seg.start_time,
                "end_time": seg.end_time,
                "text": seg.text,
                "words": seg.words_json or [],
            }
            for seg in tr.segments
        ]
        return {
            "id": tr.id,
            "source_id": tr.source_id,
            "language": tr.language,
            "model": tr.model,
            "duration": tr.duration,
            "segments": segments,
        }
    finally:
        db.close()


@app.get("/api/sources/{source_id}/clips")
def get_source_clips(source_id: str):
    """Retrieve all discovered clips for a specific source."""
    db = SessionLocal()
    try:
        v = db.query(Video).filter(Video.id == source_id).first()
        clips = db.query(Clip).filter(Clip.source_id == source_id, Clip.deleted_at == None).order_by(Clip.start_time.asc()).all()
        src_stream = to_stream_url(v.source_path) if v else None

        if not clips and source_id in jobs_db:
            job = jobs_db[source_id]
            candidates = job.get("candidates") or []
            return [
                {
                    "id": f"{source_id}_{idx}",
                    "source_id": source_id,
                    "title": c.get("title") or c.get("rank_title") or f"Clip {idx+1}",
                    "start_time": c.get("start_time") or c.get("start") or 0.0,
                    "end_time": c.get("end_time") or c.get("end") or 0.0,
                    "duration": c.get("duration") or round(max(0.0, (c.get("end_time") or c.get("end") or 0.0) - (c.get("start_time") or c.get("start") or 0.0)), 2),
                    "ai_score": c.get("score") or c.get("ai_score") or 0,
                    "virality_score": c.get("virality_score") or c.get("score") or 0,
                    "hook_sentence": c.get("hook_sentence") or c.get("hook") or "",
                    "emoji": c.get("emoji", "🔥"),
                    "category": job.get("category", "General"),
                    "tags": c.get("tags") or [],
                    "is_favorite": False,
                    "is_edited": False,
                }
                for idx, c in enumerate(candidates)
            ]

        return [
            {
                "id": c.id,
                "source_id": c.source_id,
                "title": c.title,
                "original_title": c.original_title,
                "start_time": c.start_time,
                "end_time": c.end_time,
                "duration": round(c.end_time - c.start_time, 2) if c.end_time is not None and c.start_time is not None else 0.0,
                "ai_score": c.ai_score,
                "ai_reason": c.ai_reason,
                "hook_sentence": c.hook_sentence,
                "emoji": c.emoji,
                "category": c.category,
                "character_name": c.character_name,
                "tags": c.tags or [],
                "is_favorite": c.is_favorite,
                "is_edited": c.is_edited,
                "is_archived": c.is_archived,
                "source_stream_url": src_stream,
                "source_video_title": v.title if v else "",
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in clips
        ]
    finally:
        db.close()


# ------------------------------------------------------------------------------
# Productions Endpoints
# ------------------------------------------------------------------------------

@app.get("/api/productions")
def list_productions():
    """List all productions with their status, template, and clip counts."""
    db = SessionLocal()
    try:
        prods = db.query(Production).order_by(Production.created_at.desc()).all()
        result = []
        for p in prods:
            total_duration = 0.0
            for pc in p.clips:
                c = pc.clip
                if c:
                    st = pc.start_override if pc.start_override is not None else c.start_time
                    et = pc.end_override if pc.end_override is not None else c.end_time
                    total_duration += max(0.0, et - st)

            result.append({
                "id": p.id,
                "name": p.name,
                "template": p.template,
                "aspect_ratio": p.aspect_ratio,
                "layout_mode": p.layout_mode,
                "clip_count": len(p.clips),
                "total_duration": round(total_duration, 1),
                "max_duration": p.max_duration,
                "title": p.title,
                "status": p.status,
                "render_progress": p.render_progress,
                "render_error": p.render_error,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            })
        return result
    finally:
        db.close()


@app.post("/api/productions")
def create_production(request: ProductionCreateRequest):
    """Create a new Production from a list of selected clips."""
    db = SessionLocal()
    try:
        prod_id = f"prod_{uuid.uuid4().hex[:8]}"
        prod_name = (request.title.strip() if request.title else (request.name.strip() if request.name else "Untitled Production"))
        prod = Production(
            id=prod_id,
            name=prod_name,
            title=prod_name,
            template=request.template or "ranking",
            aspect_ratio=request.aspect_ratio or "9:16",
            layout_mode=request.layout_mode or "1:1",
            max_duration=request.max_duration or 60.0,
            channel_handle=request.channel_handle,
            transition_type=request.transition_type or "swoosh",
            countdown_order=bool(request.countdown_order),
            font_family=request.font_family or "minimal",
            status="draft",
        )
        db.add(prod)
        db.flush()

        for idx, cid in enumerate(request.clip_ids):
            pclip = ProductionClip(
                id=f"pclip_{uuid.uuid4().hex[:8]}",
                production_id=prod_id,
                clip_id=cid,
                position=idx,
            )
            db.add(pclip)

        db.commit()
    finally:
        db.close()

    return get_production(prod_id)


@app.get("/api/productions/{production_id}")
def get_production(production_id: str):
    """Get full production details with ordered clips and overrides."""
    db = SessionLocal()
    try:
        p = db.query(Production).filter(Production.id == production_id).first()
        if not p:
            raise HTTPException(status_code=404, detail=f"Production '{production_id}' not found.")

        clips_data = []
        total_duration = 0.0
        for pc in p.clips:
            c = pc.clip
            if not c:
                continue
            src = c.source
            st = pc.start_override if pc.start_override is not None else c.start_time
            et = pc.end_override if pc.end_override is not None else c.end_time
            dur = max(0.0, et - st)
            total_duration += dur

            clips_data.append({
                "production_clip_id": pc.id,
                "clip_id": c.id,
                "position": pc.position,
                "title": pc.custom_title or c.title,
                "original_title": c.original_title,
                "start_time": st,
                "end_time": et,
                "clip_start_time": c.start_time,
                "clip_end_time": c.end_time,
                "start_override": pc.start_override,
                "end_override": pc.end_override,
                "custom_title": pc.custom_title,
                "duration": round(dur, 2),
                "ai_score": c.ai_score,
                "emoji": c.emoji or "🔥",
                "category": c.category or "General",
                "thumbnail_url": f"/api/clips/{c.id}/thumbnail",
                "source_stream_url": to_stream_url(src.source_path) if src else None,
                "source_video_title": src.title if src else "",
            })

        latest_render = db.query(Render).filter(Render.production_id == p.id, Render.status == "completed").order_by(Render.created_at.desc()).first()

        return {
            "id": p.id,
            "name": p.name,
            "template": p.template,
            "aspect_ratio": p.aspect_ratio,
            "layout_mode": p.layout_mode,
            "title": p.title,
            "description": p.description,
            "tags": p.tags or [],
            "hashtags": p.hashtags or [],
            "caption_settings": p.caption_settings or {
                "captions_enabled": True,
                "font": "minimal",
                "font_size": 48,
                "text_color": "#FFFFFF",
                "highlight_color": "#FFCC00",
                "position": "center",
            },
            "max_duration": p.max_duration,
            "total_duration": round(total_duration, 1),
            "transition_type": p.transition_type,
            "countdown_order": bool(getattr(p, 'countdown_order', False)),
            "font_family": getattr(p, "font_family", "minimal") or "minimal",
            "channel_handle": p.channel_handle,
            "status": p.status,
            "render_progress": p.render_progress,
            "render_error": p.render_error,
            "clips": clips_data,
            "latest_render": {
                "id": latest_render.id,
                "video_url": to_stream_url(latest_render.output_file_path),
                "render_hash": latest_render.render_hash,
                "created_at": latest_render.created_at.isoformat() if latest_render.created_at else None,
            } if latest_render else None,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        }
    finally:
        db.close()


@app.patch("/api/productions/{production_id}")
def patch_production(production_id: str, request: ProductionPatchRequest):
    """Update production configuration, sequencing, trim overrides, and metadata."""
    db = SessionLocal()
    try:
        p = db.query(Production).filter(Production.id == production_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Production not found")

        if request.name is not None:
            p.name = request.name.strip()
        if request.template is not None:
            p.template = request.template
        if request.aspect_ratio is not None:
            p.aspect_ratio = request.aspect_ratio
        if request.layout_mode is not None:
            p.layout_mode = request.layout_mode
        if request.title is not None:
            p.title = request.title.strip()
        if request.description is not None:
            p.description = request.description
        if request.tags is not None:
            p.tags = request.tags
        if request.hashtags is not None:
            p.hashtags = request.hashtags
        if request.caption_settings is not None:
            p.caption_settings = request.caption_settings
        if request.max_duration is not None:
            p.max_duration = float(request.max_duration)
        if request.transition_type is not None:
            p.transition_type = request.transition_type
        if request.countdown_order is not None:
            p.countdown_order = bool(request.countdown_order)
        if request.font_family is not None:
            p.font_family = request.font_family
        if request.channel_handle is not None:
            p.channel_handle = request.channel_handle.strip()

        if request.clips is not None:
            db.query(ProductionClip).filter(ProductionClip.production_id == p.id).delete()
            for idx, c_in in enumerate(request.clips):
                pclip = ProductionClip(
                    id=f"pclip_{uuid.uuid4().hex[:8]}",
                    production_id=p.id,
                    clip_id=c_in.clip_id,
                    position=idx,
                    custom_title=c_in.custom_title,
                    start_override=c_in.start_override,
                    end_override=c_in.end_override,
                )
                db.add(pclip)

        db.commit()
        return {"status": "success", "production_id": production_id}
    finally:
        db.close()


@app.delete("/api/productions/{production_id}")
def delete_production(production_id: str):
    """Delete a production."""
    db = SessionLocal()
    try:
        p = db.query(Production).filter(Production.id == production_id).first()
        if p:
            db.delete(p)
            db.commit()
        return {"status": "success", "deleted_production_id": production_id}
    finally:
        db.close()


def _get_render_file_info(file_path: Optional[str]):
    """Return (file_size_bytes, duration_seconds) for a rendered video file."""
    if not file_path or not os.path.exists(file_path):
        return None, None
    fsize = None
    try:
        fsize = os.path.getsize(file_path)
    except Exception:
        pass
    dur = None
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            file_path,
        ]
        out = subprocess.check_output(cmd, text=True).strip()
        if out:
            data = json.loads(out)
            if "format" in data and "duration" in data["format"]:
                dur = round(float(data["format"]["duration"]), 2)
    except Exception:
        pass
    return fsize, dur


def _run_production_render_sync(production_id: str):
    """Background worker executing render_production with deterministic caching."""
    db = SessionLocal()
    try:
        p = db.query(Production).filter(Production.id == production_id).first()
        if not p:
            print(f"[render] Production {production_id} not found.", flush=True)
            return

        p.status = "rendering"
        p.render_progress = "Preparing clips and checking cache..."
        p.render_error = None
        db.commit()

        clips_for_engine = []
        for pc in p.clips:
            c = pc.clip
            if not c:
                continue
            src = c.source
            source_p = src.source_path if src else None
            st = pc.start_override if pc.start_override is not None else c.start_time
            et = pc.end_override if pc.end_override is not None else c.end_time
            title = pc.custom_title or c.title

            clip_transcript = _resolve_source_transcript(
                db,
                src.id if src else (c.source_id if c else None),
                src,
                clip_start=st,
                clip_end=et,
            )

            clips_for_engine.append({
                "id": c.id,
                "clip_id": c.id,
                "rank_title": title,
                "title": title,
                "start_time": st,
                "end_time": et,
                "source_path": source_p,
                "source_video_path": source_p,
                "transcript": clip_transcript,
                "emoji": c.emoji or "🔥",
            })

        if not clips_for_engine:
            p.status = "failed"
            p.render_error = "Production contains no clips."
            db.commit()
            return

        header_title = p.title or p.name or "RANKING VIRAL MOMENTS"

        caps_cfg = p.caption_settings
        if not caps_cfg:
            caps_cfg = {
                "captions_enabled": True,
                "animation": "karaoke",
                "primary_color": "&H00FFFF&",
                "font": "dejavu",
                "size": "54",
            }
        elif isinstance(caps_cfg, dict):
            caps_cfg = dict(caps_cfg)
            if "captions_enabled" not in caps_cfg:
                caps_cfg["captions_enabled"] = (caps_cfg.get("animation") != "none")
            if "font" not in caps_cfg and "caption_font" not in caps_cfg:
                caps_cfg["font"] = "dejavu"
            if "size" not in caps_cfg and "caption_size" not in caps_cfg:
                caps_cfg["size"] = "54"

        def _prog(cur, tot, title):
            sub_db = SessionLocal()
            try:
                sub_p = sub_db.query(Production).filter(Production.id == production_id).first()
                if sub_p:
                    sub_p.render_progress = f"Rendering clip {cur}/{tot}: {title}"
                    sub_db.commit()
            finally:
                sub_db.close()

        out_path, render_hash, is_cached = render_engine.render_production(
            production_id=production_id,
            header_title=header_title,
            clips=clips_for_engine,
            template=p.template or "ranking",
            aspect_ratio=p.aspect_ratio or "9:16",
            layout_mode=p.layout_mode or "1:1",
            caption_settings=caps_cfg,
            channel_handle=p.channel_handle,
            transition_type=p.transition_type or "swoosh",
            countdown_order=bool(getattr(p, 'countdown_order', False)),
            font_family=getattr(p, 'font_family', 'minimal') or 'minimal',
            progress_callback=_prog,
            output_dir=OUTPUT_DIR,
        )

        fsize, dur = _get_render_file_info(out_path)

        render_id = f"render_{render_hash}"
        existing_rend = db.query(Render).filter(Render.render_hash == render_hash).first()
        if not existing_rend:
            rend = Render(
                id=render_id,
                production_id=p.id,
                render_hash=render_hash,
                header_title=header_title,
                output_file_path=out_path,
                file_size_bytes=fsize,
                duration=dur,
                template=p.template,
                aspect_ratio=p.aspect_ratio,
                is_preview=False,
                status="completed",
            )
            db.add(rend)
        else:
            existing_rend.output_file_path = out_path
            existing_rend.file_size_bytes = fsize
            existing_rend.duration = dur
            existing_rend.status = "completed"

        p.status = "completed"
        p.render_progress = "Render completed successfully!"
        p.render_error = None
        db.commit()
        print(f"[render] Successfully completed render for production {production_id}: {out_path} (cached={is_cached})", flush=True)

    except Exception as e:
        db.rollback()
        print(f"[render] Error rendering production {production_id}: {e}", flush=True)
        try:
            p = db.query(Production).filter(Production.id == production_id).first()
            if p:
                p.status = "failed"
                p.render_error = str(e)
                p.render_progress = "Render failed."
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@app.post("/api/productions/{production_id}/render", status_code=status.HTTP_202_ACCEPTED)
async def trigger_production_render(production_id: str, background_tasks: BackgroundTasks):
    """Trigger on-demand rendering of a Production Short."""
    db = SessionLocal()
    try:
        p = db.query(Production).filter(Production.id == production_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Production not found")
        if not p.clips:
            raise HTTPException(status_code=400, detail="Production has no clips to render.")

        p.status = "rendering"
        p.render_progress = "Starting render..."
        p.render_error = None
        db.commit()

        background_tasks.add_task(_run_production_render_sync, production_id)
        return {"status": "accepted", "production_id": production_id, "message": "Render scheduled."}
    finally:
        db.close()


@app.post("/api/productions/{production_id}/generate-metadata")
def generate_production_metadata(production_id: str, request: Optional[MetadataGenerateRequest] = None):
    """Generate viral YouTube Short Title, Description, Tags, and Hashtags using Gemini AI."""
    db = SessionLocal()
    try:
        p = db.query(Production).filter(Production.id == production_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Production not found")

        clip_titles = [pc.custom_title or (pc.clip.title if pc.clip else "") for pc in p.clips]
        hooks = [pc.clip.hook_sentence for pc in p.clips if pc.clip and pc.clip.hook_sentence]
        focus = request.focus_topic if (request and request.focus_topic) else (p.name or "viral moments")

        prompt = f"""You are a YouTube Shorts growth expert. Generate viral metadata for this YouTube Short.
Production Name: {p.name}
Focus Topic: {focus}
Template: {p.template}
Clips in this Short: {', '.join(clip_titles)}
Hook lines: {', '.join(hooks[:5])}

Generate:
1. "title": A high-CTR, punchy YouTube Short title under 60 characters with emojis.
2. "description": An engaging 2-3 sentence description with a call to subscribe.
3. "tags": An array of 8-12 relevant search tags.
4. "hashtags": An array of 4-6 hashtags (e.g. #shorts, #viral).

Respond ONLY with valid JSON (no markdown):
{{"title": "...", "description": "...", "tags": ["tag1", "tag2"], "hashtags": ["#shorts", "#viral"]}}
"""
        from shorts_generator.local.llm import call_local_llm
        raw = call_local_llm(prompt)
        import re
        clean = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        clean = re.sub(r"\s*```$", "", clean)
        metadata = json.loads(clean)
        sug_title = metadata.get("title", f"TOP {len(clip_titles)} VIRAL MOMENTS 🤯")
        sug_desc = metadata.get("description", "Watch the most unhinged and hilarious moments! Subscribe for more daily viral shorts.")
        sug_tags = metadata.get("tags", ["shorts", "viral", "funny", "family guy", "best moments"])
        sug_hashes = metadata.get("hashtags", ["#shorts", "#viral", "#funny", "#trending"])
        return {
            "status": "success",
            "production_id": production_id,
            "youtube_title": sug_title,
            "youtube_description": sug_desc,
            "youtube_tags": sug_tags,
            "youtube_hashtags": sug_hashes,
            "suggestions": {
                "title": sug_title,
                "description": sug_desc,
                "tags": sug_tags,
                "hashtags": sug_hashes,
            }
        }
    except Exception as e:
        print(f"[server] Error generating metadata: {e}", flush=True)
        fb_title = f"TOP {len(p.clips if p else [])} MOMENTS YOU CAN'T MISS 🔥"
        fb_desc = "The funniest and wildest highlights compiled into one short. Subscribe for more!"
        fb_tags = ["shorts", "viral", "highlights", "trending"]
        fb_hashes = ["#shorts", "#viral", "#trending"]
        return {
            "status": "fallback",
            "youtube_title": fb_title,
            "youtube_description": fb_desc,
            "youtube_tags": fb_tags,
            "youtube_hashtags": fb_hashes,
            "suggestions": {
                "title": fb_title,
                "description": fb_desc,
                "tags": fb_tags,
                "hashtags": fb_hashes,
            }
        }
    finally:
        db.close()


# ------------------------------------------------------------------------------
# Renders Endpoints
# ------------------------------------------------------------------------------

@app.get("/api/renders")
def list_renders():
    """Output Library API: list all finished and legacy rendered shorts."""
    db = SessionLocal()
    try:
        renders = db.query(Render).order_by(Render.created_at.desc()).all()
        result = []
        needs_commit = False
        for r in renders:
            fsize = r.file_size_bytes
            dur = r.duration
            if (fsize is None or fsize == 0 or dur is None or dur == 0) and r.output_file_path and os.path.exists(r.output_file_path):
                calc_size, calc_dur = _get_render_file_info(r.output_file_path)
                if (fsize is None or fsize == 0) and calc_size:
                    r.file_size_bytes = calc_size
                    fsize = calc_size
                    needs_commit = True
                if (dur is None or dur == 0) and calc_dur:
                    r.duration = calc_dur
                    dur = calc_dur
                    needs_commit = True

            stream_url = to_stream_url(r.output_file_path)
            display_title = r.header_title or "Rendered Short"
            result.append({
                "id": r.id,
                "production_id": r.production_id,
                "header_title": display_title,
                "title": display_title,
                "video_url": stream_url,
                "stream_url": stream_url,
                "output_file_path": r.output_file_path,
                "output_path": r.output_file_path,
                "file_size_bytes": fsize or 0,
                "file_size": fsize or 0,
                "duration": dur,
                "template": r.template,
                "aspect_ratio": r.aspect_ratio,
                "status": r.status,
                "render_hash": r.render_hash,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        if needs_commit:
            try:
                db.commit()
            except Exception:
                pass
        return result
    finally:
        db.close()


@app.get("/api/renders/{render_id}")
def get_render_item(render_id: str):
    """Get single render details."""
    db = SessionLocal()
    try:
        r = db.query(Render).filter(Render.id == render_id).first()
        if not r:
            raise HTTPException(status_code=404, detail="Render not found")
        fsize = r.file_size_bytes
        dur = r.duration
        if (fsize is None or fsize == 0 or dur is None or dur == 0) and r.output_file_path and os.path.exists(r.output_file_path):
            calc_size, calc_dur = _get_render_file_info(r.output_file_path)
            if (fsize is None or fsize == 0) and calc_size:
                r.file_size_bytes = calc_size
                fsize = calc_size
            if (dur is None or dur == 0) and calc_dur:
                r.duration = calc_dur
                dur = calc_dur
            try:
                db.commit()
            except Exception:
                pass

        stream_url = to_stream_url(r.output_file_path)
        display_title = r.header_title or "Rendered Short"
        return {
            "id": r.id,
            "production_id": r.production_id,
            "header_title": display_title,
            "title": display_title,
            "video_url": stream_url,
            "stream_url": stream_url,
            "output_file_path": r.output_file_path,
            "output_path": r.output_file_path,
            "file_size_bytes": fsize or 0,
            "file_size": fsize or 0,
            "duration": dur,
            "template": r.template,
            "aspect_ratio": r.aspect_ratio,
            "status": r.status,
            "render_hash": r.render_hash,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
    finally:
        db.close()


@app.delete("/api/renders/{render_id}")
def delete_render_item(render_id: str):
    """Delete a render record."""
    db = SessionLocal()
    try:
        r = db.query(Render).filter(Render.id == render_id).first()
        if r:
            db.delete(r)
            db.commit()
        return {"status": "success", "deleted_render_id": render_id}
    finally:
        db.close()


# ------------------------------------------------------------------------------
# Bulk Clip Operations
# ------------------------------------------------------------------------------

@app.post("/api/clips/bulk-edit")
def bulk_edit_clips(request: ClipBulkEditRequest):
    """Batch update multiple clips in a single lightweight transaction."""
    db = SessionLocal()
    try:
        updated_count = 0
        for item in request.updates:
            c = db.query(Clip).filter(Clip.id == item.id).first()
            if not c:
                continue
            if item.title is not None:
                c.title = item.title.strip()
                c.is_edited = True
            if item.start_time is not None:
                c.start_time = float(item.start_time)
                c.is_edited = True
            if item.end_time is not None:
                c.end_time = float(item.end_time)
                c.is_edited = True
            if item.is_favorite is not None:
                c.is_favorite = item.is_favorite
            if item.is_archived is not None:
                c.is_archived = item.is_archived
            updated_count += 1
        db.commit()
        return {"status": "success", "updated_count": updated_count}
    finally:
        db.close()


@app.post("/api/clips/bulk-favorite")
def bulk_favorite_clips(request: ClipBulkFavoriteRequest):
    """Toggle favorite status on a list of clip IDs."""
    db = SessionLocal()
    try:
        count = db.query(Clip).filter(Clip.id.in_(request.clip_ids)).update(
            {Clip.is_favorite: request.is_favorite},
            synchronize_session=False
        )
        db.commit()
        return {"status": "success", "modified_count": count}
    finally:
        db.close()


@app.post("/api/clips/bulk-delete")
def bulk_delete_clips(request: ClipBulkDeleteRequest):
    """Archive a list of clip IDs."""
    db = SessionLocal()
    try:
        count = db.query(Clip).filter(Clip.id.in_(request.clip_ids)).update(
            {Clip.is_archived: True, Clip.deleted_at: datetime.utcnow()},
            synchronize_session=False
        )
        db.commit()
        return {"status": "success", "archived_count": count}
    finally:
        db.close()


# ==============================================================================
# Legacy REST Endpoints (Preserved for backwards compatibility)
# ==============================================================================
@app.post("/api/jobs/batch", status_code=status.HTTP_202_ACCEPTED)
async def create_batch_jobs(request: BatchJobRequest):
    batch_id = f"batch_{uuid.uuid4().hex[:8]}"
    created_jobs = []
    category = request.category.strip() if (request.category and request.category.strip()) else "Family Guy"

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
                "category": category,
                "num_clips": request.num_clips,
                "aspect_ratio": request.aspect_ratio,
                "layout_mode": request.layout_mode,
                "template_type": request.template_type or "ranking",
                "font_family": request.font_family or "minimal",
                "transition_type": request.transition_type or "swoosh",
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
async def list_jobs(category: Optional[str] = None):
    async with jobs_lock:
        _load_jobs_from_disk()
        sorted_jobs = sorted(
            jobs_db.values(),
            key=lambda x: x.get("created_at", ""),
            reverse=True,
        )
        enriched = [_enrich_job(j) for j in sorted_jobs]
        if category and category.lower() != "all":
            enriched = [j for j in enriched if (j.get("category") or "").lower() == category.lower()]
        return enriched


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
    countdown_order: bool = False,
    transition_type: str = "swoosh",
    font_family: str = "minimal",
):
    """Background rendering worker running in a thread pool without blocking the async event loop."""
    print(f"[render_worker] Starting background render for job {job_id} ({len(clips_to_render)} clips, template: {template_type}, font: {font_family}, countdown: {countdown_order}, transition: {transition_type})...", flush=True)

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
            countdown_order=countdown_order,
            transition_type=transition_type,
            font_family=font_family,
        )
        import shutil
        shutil.copyfile(custom_mp4, os.path.join(OUTPUT_DIR, "final_short.mp4"))

        job = jobs_db.get(job_id) or {}
        job["final_video_url"] = f"/output/job_{job_id}/final_short.mp4"
        job["rendered_header_title"] = header_title
        job["layout_mode"] = layout_mode
        job["template_type"] = template_type
        job["font_family"] = font_family
        job["transition_type"] = transition_type
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
        job["render_progress"] = f"Render failed: {str(e)}"
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

    if not transcript_data:
        db_sub = SessionLocal()
        try:
            transcript_data = _resolve_source_transcript(db_sub, job_id)
        finally:
            db_sub.close()

    job_out_dir = os.path.join(OUTPUT_DIR, f"job_{job_id}")
    os.makedirs(job_out_dir, exist_ok=True)
    custom_mp4 = os.path.join(job_out_dir, "final_short.mp4")
    work_dir = os.path.join(job_out_dir, "custom_render_work")

    header_title = (request.header_title or job.get("header_title") or "RANKING VIRAL MOMENTS").strip()
    layout_mode = request.layout_mode or job.get("layout_mode", "1:1")
    channel_handle = request.channel_handle or job.get("channel_handle")
    captions_enabled = request.captions_enabled if request.captions_enabled is not None else True
    template_type = request.template_type or job.get("template_type", "ranking")
    font_family = request.font_family or job.get("font_family", "minimal")
    category = request.category or job.get("category", "Family Guy")
    transition_type = request.transition_type or job.get("transition_type", "swoosh")

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
            job["font_family"] = font_family
            job["category"] = category
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

            if v and category:
                v.category = category

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
                    if category:
                        cand_row.category = category
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
                        category=category,
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
            job["font_family"] = font_family
            job["category"] = category
            job["transition_type"] = transition_type
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
        countdown_order=bool(request.countdown_order),
        transition_type=transition_type,
        font_family=font_family,
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


def _serialize_clip_record(clip, video=None):
    v = video or getattr(clip, "source", None) or getattr(clip, "video", None)
    source_path = getattr(v, "source_path", None) if v else None
    src_stream = to_stream_url(source_path) if source_path else None

    tags_val = getattr(clip, "tags", None)
    if isinstance(tags_val, list):
        tags_list = tags_val
    elif isinstance(tags_val, str) and tags_val:
        tags_list = [t.strip() for t in tags_val.split(",") if t.strip()]
    else:
        tags_list = []

    title_val = getattr(clip, "title", None) or getattr(clip, "rank_title", "Untitled Clip")
    ai_score_val = getattr(clip, "ai_score", None) or getattr(clip, "virality_score", 85)
    source_id_val = getattr(clip, "source_id", None) or getattr(clip, "video_id", None) or (v.id if v else "")

    used_count = 0
    if hasattr(clip, "production_clips") and clip.production_clips:
        used_count = len(clip.production_clips)

    return {
        "id": clip.id,
        "source_id": source_id_val,
        "video_id": source_id_val,
        "title": title_val,
        "rank_title": title_val,
        "original_title": getattr(clip, "original_title", title_val),
        "start_time": float(clip.start_time),
        "end_time": float(clip.end_time),
        "duration": round(float(clip.end_time) - float(clip.start_time), 2),
        "ai_score": int(ai_score_val),
        "virality_score": int(ai_score_val),
        "ai_reason": getattr(clip, "ai_reason", None),
        "hook_sentence": getattr(clip, "hook_sentence", None),
        "emoji": getattr(clip, "emoji", "🔥") or "🔥",
        "category": getattr(clip, "category", None) or (v.category if v else "General") or "General",
        "character": getattr(clip, "character_name", None),
        "character_name": getattr(clip, "character_name", None),
        "tags": tags_list,
        "is_favorite": bool(getattr(clip, "is_favorite", False)),
        "is_edited": bool(getattr(clip, "is_edited", False)),
        "is_archived": bool(getattr(clip, "is_archived", False)),
        "source_stream_url": src_stream,
        "thumbnail_url": f"/api/clips/{clip.id}/thumbnail",
        "source_title": v.title if v else None,
        "video_title": v.title if v else None,
        "used_in_productions_count": used_count,
        "created_at": clip.created_at.isoformat() if getattr(clip, "created_at", None) else None,
    }


@app.get("/api/clips")
def list_clips(
    category: Optional[str] = None,
    character: Optional[str] = None,
    search: Optional[str] = None,
    filter: Optional[str] = "all",
    sort: Optional[str] = "score_desc",
    grouped: bool = False,
    page: int = 1,
    limit: int = 100,
):
    """Retrieve clips with search, filtering, sorting, and optional video grouping."""
    db = SessionLocal()
    try:
        query = db.query(Clip).filter(Clip.deleted_at.is_(None))

        # Filter preset
        f = (filter or "all").lower()
        if f == "favorites":
            query = query.filter(Clip.is_favorite == True)
        elif f == "edited":
            query = query.filter(Clip.is_edited == True)
        elif f == "archived":
            query = query.filter(Clip.is_archived == True)
        elif f == "new":
            query = query.filter(Clip.is_edited == False, ~Clip.production_clips.any())
        elif f == "used":
            query = query.filter(Clip.production_clips.any())
        elif f == "unused":
            query = query.filter(~Clip.production_clips.any())

        if f != "archived":
            query = query.filter(Clip.is_archived == False)

        if category and category.lower() != "all":
            query = query.filter(func.lower(Clip.category) == category.lower())

        if character and character.lower() != "all":
            query = query.filter(Clip.character_name == character)

        if search and search.strip():
            s = f"%{search.strip().lower()}%"
            query = query.join(Video, Clip.source_id == Video.id, isouter=True).filter(
                or_(
                    func.lower(Clip.title).like(s),
                    func.lower(Clip.character_name).like(s),
                    func.lower(Clip.hook_sentence).like(s),
                    func.lower(Video.title).like(s),
                )
            )

        # Sorting
        if sort == "score_asc":
            query = query.order_by(Clip.ai_score.asc())
        elif sort == "date_desc":
            query = query.order_by(Clip.created_at.desc())
        elif sort == "date_asc":
            query = query.order_by(Clip.created_at.asc())
        elif sort == "duration_asc":
            query = query.order_by((Clip.end_time - Clip.start_time).asc())
        elif sort == "duration_desc":
            query = query.order_by((Clip.end_time - Clip.start_time).desc())
        elif sort == "title_asc":
            query = query.order_by(Clip.title.asc())
        else:
            query = query.order_by(Clip.ai_score.desc())

        if grouped:
            clips = query.all()
            groups_map = {}
            for c in clips:
                v = c.source
                vid = c.source_id
                if vid not in groups_map:
                    groups_map[vid] = {
                        "video_id": vid,
                        "video_title": v.title if (v and v.title) else f"Video ({vid[:8]})",
                        "category": v.category if v else (c.category or "General"),
                        "video_category": v.category if v else (c.category or "General"),
                        "youtube_url": v.youtube_url if v else None,
                        "duration": v.duration if v else 0,
                        "source_stream_url": to_stream_url(v.source_path) if (v and v.source_path) else None,
                        "clips": [],
                    }
                groups_map[vid]["clips"].append(_serialize_clip_record(c, v))
            return list(groups_map.values())

        total = query.count()
        clips = query.offset((page - 1) * limit).limit(limit).all()
        return {
            "items": [_serialize_clip_record(c) for c in clips],
            "total": total,
            "page": page,
            "limit": limit,
            "has_more": (page * limit) < total,
        }
    except Exception as e:
        print(f"[api/clips] Warning: error listing clips: {e}", flush=True)
        return {"items": [], "total": 0, "page": page, "limit": limit, "has_more": False} if not grouped else []
    finally:
        db.close()


@app.get("/api/categories")
def list_categories():
    """List all distinct categories across jobs and clips."""
    cats = set(["Family Guy", "Modern Family"])
    db = SessionLocal()
    try:
        for c in db.query(Clip.category).distinct().all():
            if c[0] and c[0] != "General":
                cats.add(c[0])
        for v in db.query(Video.category).distinct().all():
            if v[0] and v[0] != "General":
                cats.add(v[0])
    except Exception:
        pass
    finally:
        db.close()
    for j in jobs_db.values():
        if j.get("category") and j["category"] != "General":
            cats.add(j["category"])
    return sorted(list(cats))


@app.get("/api/clips/{clip_id}")
def get_clip(clip_id: str):
    """Retrieve full details for a single clip."""
    db = SessionLocal()
    try:
        clip = db.query(Clip).filter(Clip.id == clip_id, Clip.deleted_at.is_(None)).first()
        if not clip:
            cand = db.query(ClipCandidate).filter(ClipCandidate.id == clip_id).first()
            if not cand:
                raise HTTPException(status_code=404, detail="Clip not found.")
            return _serialize_clip_record(cand)
        return _serialize_clip_record(clip)
    finally:
        db.close()


@app.get("/api/clips/{clip_id}/thumbnail")
def get_clip_thumbnail(clip_id: str):
    """Serve or generate on-demand lightweight JPEG thumbnail for a clip at its start_time."""
    thumbs_dir = os.path.join(OUTPUT_DIR, "thumbnails")
    os.makedirs(thumbs_dir, exist_ok=True)
    thumb_path = os.path.join(thumbs_dir, f"{clip_id}.jpg")

    if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
        return FileResponse(thumb_path, media_type="image/jpeg")

    db = SessionLocal()
    try:
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        if not clip:
            cand = db.query(ClipCandidate).filter(ClipCandidate.id == clip_id).first()
            if not cand:
                raise HTTPException(status_code=404, detail="Clip not found.")
            clip = cand

        v = getattr(clip, "source", None) or getattr(clip, "video", None)
        if not v and hasattr(clip, "source_id"):
            v = db.query(Video).filter(Video.id == clip.source_id).first()
        if not v and hasattr(clip, "video_id"):
            v = db.query(Video).filter(Video.id == clip.video_id).first()

        src_path = v.source_path if v else None
        if src_path and os.path.exists(src_path):
            st = max(0.0, float(clip.start_time) + 0.5)
            import subprocess
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(st),
                "-i", src_path,
                "-frames:v", "1",
                "-q:v", "4",
                "-vf", "scale=480:-1",
                thumb_path,
            ]
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=10)
                if os.path.exists(thumb_path):
                    return FileResponse(thumb_path, media_type="image/jpeg")
            except Exception as e:
                print(f"[thumbnail] error generating for {clip_id}: {e}", flush=True)

        if v and v.thumbnail_url:
            return RedirectResponse(v.thumbnail_url)
        elif v and v.youtube_video_id:
            return RedirectResponse(f"https://img.youtube.com/vi/{v.youtube_video_id}/hqdefault.jpg")

        svg = """<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" fill="#090d16"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#475569" font-family="sans-serif" font-weight="600" font-size="18">Clip Frame</text></svg>"""
        return Response(content=svg, media_type="image/svg+xml")
    finally:
        db.close()


@app.patch("/api/clips/{clip_id}")
@app.put("/api/clips/{clip_id}")
async def update_clip_details(clip_id: str, request: ClipUpdateRequest):
    """Update title, trim start/end timestamps, category, character, or tags without rendering."""
    db = SessionLocal()
    try:
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        cand = db.query(ClipCandidate).filter(ClipCandidate.id == clip_id).first()
        if not clip and not cand:
            raise HTTPException(status_code=404, detail="Clip not found.")

        new_title = request.title if request.title is not None else request.rank_title
        if clip:
            if new_title is not None:
                clip.title = new_title.strip()
            if request.start_time is not None:
                clip.start_time = float(request.start_time)
            if request.end_time is not None:
                clip.end_time = float(request.end_time)
            if request.category is not None:
                clip.category = request.category.strip()
            if request.character is not None:
                clip.character_name = request.character.strip()
            if request.tags is not None:
                if isinstance(request.tags, list):
                    clip.tags = request.tags
                else:
                    clip.tags = [t.strip() for t in str(request.tags).split(",") if t.strip()]
            if request.ai_score is not None:
                clip.ai_score = int(request.ai_score)
            elif request.virality_score is not None:
                clip.ai_score = int(request.virality_score)
            if request.emoji is not None:
                clip.emoji = request.emoji.strip()
            if request.hook_sentence is not None:
                clip.hook_sentence = request.hook_sentence.strip()
            if request.is_favorite is not None:
                clip.is_favorite = bool(request.is_favorite)
            if request.is_archived is not None:
                clip.is_archived = bool(request.is_archived)
            clip.is_edited = True
            clip.updated_at = datetime.utcnow()

        if cand:
            if new_title is not None:
                cand.rank_title = new_title.strip()
            if request.start_time is not None:
                cand.start_time = float(request.start_time)
            if request.end_time is not None:
                cand.end_time = float(request.end_time)
            if request.category is not None:
                cand.category = request.category.strip()
            if request.character is not None:
                cand.character_name = request.character.strip()
            if request.virality_score is not None:
                cand.virality_score = int(request.virality_score)
            elif request.ai_score is not None:
                cand.virality_score = int(request.ai_score)
            if request.emoji is not None:
                cand.emoji = request.emoji.strip()
            if request.hook_sentence is not None:
                cand.hook_sentence = request.hook_sentence.strip()

        db.commit()

        # Sync with active jobs in memory if any
        async with jobs_lock:
            for job in jobs_db.values():
                candidates = job.get("candidates") or []
                for c in candidates:
                    if str(c.get("id")) == clip_id:
                        if new_title is not None:
                            c["rank_title"] = new_title.strip()
                            c["title"] = new_title.strip()
                        if request.start_time is not None:
                            c["start_time"] = float(request.start_time)
                        if request.end_time is not None:
                            c["end_time"] = float(request.end_time)
                        if request.category is not None:
                            c["category"] = request.category.strip()
                        if request.character is not None:
                            c["character"] = request.character.strip()
            _save_jobs_to_disk()

        target = clip or cand
        db.refresh(target)
        return {
            "status": "success",
            "message": "Clip updated successfully without render.",
            "clip": _serialize_clip_record(target),
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update clip: {str(e)}")
    finally:
        db.close()


@app.delete("/api/clips/{clip_id}")
def delete_clip(clip_id: str, permanent: bool = False):
    """Delete or archive a clip."""
    db = SessionLocal()
    try:
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        if not clip:
            cand = db.query(ClipCandidate).filter(ClipCandidate.id == clip_id).first()
            if not cand:
                raise HTTPException(status_code=404, detail="Clip not found.")
            db.delete(cand)
            db.commit()
            return {"status": "success", "message": "Legacy clip deleted."}

        if permanent:
            db.delete(clip)
        else:
            clip.deleted_at = datetime.utcnow()
            clip.is_archived = True
        db.commit()
        return {"status": "success", "message": "Clip deleted successfully."}
    finally:
        db.close()



@app.put("/api/jobs/{job_id}/candidates")
async def update_job_candidates(job_id: str, request: JobCandidatesUpdateRequest):
    """Save updated candidate cuts, titles, and ranking display indices for a job without rendering."""
    async with jobs_lock:
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail="Job not found.")
        job = jobs_db[job_id]
        job["candidates"] = request.candidates
        if request.header_title is not None:
            job["header_title"] = request.header_title
        if request.layout_mode is not None:
            job["layout_mode"] = request.layout_mode
        if request.transition_type is not None:
            job["transition_type"] = request.transition_type
        if request.channel_handle is not None:
            job["channel_handle"] = request.channel_handle
        if request.captions_enabled is not None:
            job["captions_enabled"] = request.captions_enabled

        # Also mirror in result if present
        if job.get("result") and isinstance(job["result"], dict):
            job["result"]["candidates"] = request.candidates
            if request.header_title is not None:
                job["result"]["header_title"] = request.header_title

        _save_jobs_to_disk()
        return {
            "status": "success",
            "message": "Job candidate cuts and titles saved without rendering.",
            "job": _enrich_job(job),
        }


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a stuck or pending job cleanly and reset state."""
    async with jobs_lock:
        if job_id not in jobs_db:
            raise HTTPException(status_code=404, detail="Job not found.")
        job = jobs_db[job_id]
        job["status"] = "failed"
        job["progress"] = "Job cancelled by user."
        job["error"] = "Cancelled by user."
        _save_jobs_to_disk()
        return {"status": "success", "message": f"Job {job_id} cancelled."}



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

        # Determine category from request or majority of clips
        cat_counts: Dict[str, int] = {}
        for c_item in clips_data:
            c_cat = c_item.get("category") or "Family Guy"
            cat_counts[c_cat] = cat_counts.get(c_cat, 0) + 1
        default_cat = max(cat_counts, key=cat_counts.get) if cat_counts else "Family Guy"
        custom_category = request.category or default_cat

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
            "template_type": getattr(request, "template_type", "ranking") or "ranking",
            "font_family": getattr(request, "font_family", "minimal") or "minimal",
            "category": custom_category,
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


def _probe_video_file(file_path: str) -> Dict[str, Any]:
    """Probes video duration, width, height with ffprobe."""
    import subprocess
    info = {"duration": 0.0, "width": 1080, "height": 1920}
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "json",
            file_path,
        ]
        out = subprocess.check_output(cmd, text=True).strip()
        if out:
            data = json.loads(out)
            if "format" in data and "duration" in data["format"]:
                info["duration"] = float(data["format"]["duration"])
            if "streams" in data and len(data["streams"]) > 0:
                s = data["streams"][0]
                info["width"] = int(s.get("width", 1080))
                info["height"] = int(s.get("height", 1920))
    except Exception as e:
        print(f"[probe] ffprobe error on {file_path}: {e}", flush=True)
    return info


@app.post("/api/upload")
async def upload_video_files(files: List[UploadFile] = File(...)):
    """Upload one or more straight video files (.mp4, .mov, .mkv, .webm) into output/uploads/."""
    uploads_dir = os.path.join(OUTPUT_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    results = []
    for file in files:
        safe_name = os.path.basename(file.filename or f"clip_{uuid.uuid4().hex[:8]}.mp4")
        stem, ext = os.path.splitext(safe_name)
        ext = ext.lower() if ext else ".mp4"
        if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"):
            ext = ".mp4"
        unique_name = f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
        dest_path = os.path.join(uploads_dir, unique_name)

        contents = await file.read()
        with open(dest_path, "wb") as f:
            f.write(contents)

        probe = _probe_video_file(dest_path)
        stream_url = f"/output/uploads/{unique_name}"
        clean_title = stem.replace("_", " ").replace("-", " ").title()

        results.append({
            "original_filename": file.filename,
            "saved_filename": unique_name,
            "local_path": dest_path,
            "stream_url": stream_url,
            "duration": probe["duration"],
            "width": probe["width"],
            "height": probe["height"],
            "title": clean_title,
        })

    return {
        "status": "success",
        "count": len(results),
        "files": results,
    }


@app.post("/api/clips/upload")
async def upload_clips_to_repo(
    files: List[UploadFile] = File(...),
    captions_enabled: bool = Form(True),
):
    """Directly import straight MP4 files into the Clips Repository as ready-to-use clips."""
    uploads_dir = os.path.join(OUTPUT_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    db = SessionLocal()
    imported_clips = []

    try:
        for idx, file in enumerate(files):
            safe_name = os.path.basename(file.filename or f"clip_{uuid.uuid4().hex[:8]}.mp4")
            stem, ext = os.path.splitext(safe_name)
            ext = ext.lower() if ext else ".mp4"
            if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"):
                ext = ".mp4"
            unique_name = f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
            dest_path = os.path.join(uploads_dir, unique_name)

            contents = await file.read()
            with open(dest_path, "wb") as f:
                f.write(contents)

            probe = _probe_video_file(dest_path)
            duration = probe["duration"] if probe["duration"] > 0 else 60.0
            clean_title = stem.replace("_", " ").replace("-", " ").title()
            stream_url = f"/output/uploads/{unique_name}"

            # Optionally transcribe with Whisper
            t_path = None
            if captions_enabled:
                try:
                    transcribe_local(dest_path)
                    from shorts_generator.local.transcriber import _transcript_json_cache_path
                    cache_p = _transcript_json_cache_path(dest_path)
                    if cache_p.exists():
                        t_path = str(cache_p)
                except Exception as te:
                    print(f"[clips/upload] transcription warning for {unique_name}: {te}", flush=True)

            vid_id = str(uuid.uuid4())
            video_rec = Video(
                id=vid_id,
                youtube_url=stream_url,
                title=clean_title,
                duration=duration,
                source_path=dest_path,
                transcript_path=t_path,
            )
            db.add(video_rec)
            db.commit()
            db.refresh(video_rec)

            cid = str(uuid.uuid4())
            c_v2 = Clip(
                id=cid,
                source_id=video_rec.id,
                title=clean_title,
                original_title=clean_title,
                start_time=0.0,
                end_time=duration,
                ai_score=95,
                emoji="🔥",
                hook_sentence=clean_title,
                category=video_rec.category or "General",
                is_edited=False,
            )
            clip_rec = ClipCandidate(
                id=cid,
                video_id=video_rec.id,
                rank_title=clean_title,
                emoji="🔥",
                start_time=0.0,
                end_time=duration,
                virality_score=95,
                hook_sentence=clean_title,
                category=video_rec.category or "General",
            )
            db.add(c_v2)
            db.add(clip_rec)
            db.commit()
            db.refresh(clip_rec)

            imported_clips.append({
                "id": clip_rec.id,
                "video_id": video_rec.id,
                "source_id": video_rec.id,
                "title": clean_title,
                "rank_title": clip_rec.rank_title,
                "emoji": clip_rec.emoji,
                "start_time": clip_rec.start_time,
                "end_time": clip_rec.end_time,
                "virality_score": clip_rec.virality_score,
                "hook_sentence": clip_rec.hook_sentence,
                "source_stream_url": stream_url,
                "video_title": clean_title,
                "duration": duration,
            })

        return {
            "status": "success",
            "count": len(imported_clips),
            "clips": imported_clips,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to upload clips: {str(e)}")
    finally:
        db.close()


@app.post("/api/sources/upload")
async def upload_source_video(
    file: UploadFile = File(...),
    mode: str = Form("single_clip"),  # "single_clip" | "manual_cuts" | "ai_discovery"
    category: str = Form("General"),
    title: Optional[str] = Form(None),
    cuts_json: Optional[str] = Form(None),
):
    """Upload a local video file (.mp4, .mov, etc.) with 3 modes:
    1. 'single_clip': import entire video as 1 editable clip into Clips Library
    2. 'manual_cuts': full episode with user-specified timestamp cuts (e.g. 00:26:32 - 00:27:50)
    3. 'ai_discovery': full episode with automatic AI speech transcription & highlight discovery
    """
    uploads_dir = os.path.join(OUTPUT_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    safe_name = os.path.basename(file.filename or f"video_{uuid.uuid4().hex[:8]}.mp4")
    stem, ext = os.path.splitext(safe_name)
    ext = ext.lower() if ext else ".mp4"
    if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"):
        ext = ".mp4"
    unique_name = f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
    dest_path = os.path.join(uploads_dir, unique_name)

    contents = await file.read()
    with open(dest_path, "wb") as f:
        f.write(contents)

    probe = _probe_video_file(dest_path)
    duration = float(probe["duration"]) if probe["duration"] > 0 else 60.0
    clean_title = title.strip() if (title and title.strip()) else stem.replace("_", " ").replace("-", " ").title()
    stream_url = f"/output/uploads/{unique_name}"
    cat = category.strip() if (category and category.strip()) else "General"

    db = SessionLocal()
    try:
        vid_id = f"job_{uuid.uuid4().hex[:8]}"
        is_ai = (mode == "ai_discovery")

        video_rec = Video(
            id=vid_id,
            youtube_url=stream_url,
            title=clean_title,
            duration=duration,
            category=cat,
            source_path=dest_path,
            status="queued" if is_ai else "completed",
            current_stage="queued" if is_ai else "completed",
            progress="Queued for AI speech discovery..." if is_ai else "Ready",
            started_at=datetime.utcnow(),
        )
        db.add(video_rec)
        db.flush()

        created_clips = []

        if mode == "single_clip":
            cid = f"clip_{uuid.uuid4().hex[:12]}"
            c_v2 = Clip(
                id=cid,
                source_id=vid_id,
                start_time=0.0,
                end_time=duration,
                title=clean_title,
                original_title=clean_title,
                ai_score=95,
                category=cat,
                emoji="🔥",
                is_edited=False,
            )
            c_leg = ClipCandidate(
                id=cid,
                video_id=vid_id,
                rank_title=clean_title,
                emoji="🔥",
                start_time=0.0,
                end_time=duration,
                virality_score=95,
                category=cat,
            )
            db.add(c_v2)
            db.add(c_leg)
            created_clips.append(cid)

        elif mode == "manual_cuts":
            parsed_cuts = []
            if cuts_json:
                try:
                    parsed_cuts = json.loads(cuts_json)
                except Exception as e:
                    print(f"[upload] warning parsing cuts_json: {e}", flush=True)

            if not parsed_cuts:
                parsed_cuts = [{"title": clean_title, "start_time": 0.0, "end_time": duration}]

            for idx, cut in enumerate(parsed_cuts):
                st = parse_timestamp_str(cut.get("start_time"))
                et = parse_timestamp_str(cut.get("end_time"))
                if et <= st:
                    et = min(duration, st + 30.0) if st + 30.0 <= duration else duration
                cut_title = cut.get("title") or f"{clean_title} Cut #{idx + 1}"
                cut_cat = cut.get("category") or cat

                cid = f"clip_{uuid.uuid4().hex[:12]}"
                c_v2 = Clip(
                    id=cid,
                    source_id=vid_id,
                    start_time=st,
                    end_time=et,
                    title=cut_title,
                    original_title=cut_title,
                    ai_score=90,
                    category=cut_cat,
                    emoji="✂️",
                    is_edited=True,
                )
                c_leg = ClipCandidate(
                    id=cid,
                    video_id=vid_id,
                    rank_title=cut_title,
                    emoji="✂️",
                    start_time=st,
                    end_time=et,
                    virality_score=90,
                    category=cut_cat,
                )
                db.add(c_v2)
                db.add(c_leg)
                created_clips.append(cid)

        elif mode == "ai_discovery":
            job_data = {
                "id": vid_id,
                "url": stream_url,
                "category": cat,
                "title": clean_title,
                "duration": duration,
                "aspect_ratio": "9:16",
                "layout_mode": "1:1",
                "status": "queued",
                "current_stage": "queued",
                "progress": "Queued for AI speech discovery...",
                "num_clips": 10,
                "source_path": dest_path,
                "source_stream_url": stream_url,
            }
            async with jobs_lock:
                jobs_db[vid_id] = job_data
                _save_jobs_to_disk()

            try:
                task = celery_app.send_task(
                    "process_video_task",
                    args=[vid_id, job_data],
                    countdown=0,
                )
                async with jobs_lock:
                    job_data["celery_task_id"] = task.id
                    _save_jobs_to_disk()
            except Exception:
                loop = asyncio.get_running_loop()
                loop.run_in_executor(executor, _process_job_sync, job_data)

        db.commit()

        redirect_url = (
            f"/clips/edit?ids={created_clips[0]}"
            if mode == "single_clip" and created_clips
            else f"/sources/{vid_id}"
        )

        return {
            "status": "success",
            "mode": mode,
            "source_id": vid_id,
            "clips_count": len(created_clips),
            "clip_ids": created_clips,
            "title": clean_title,
            "duration": duration,
            "redirect_url": redirect_url,
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

            # 4. Resolve Title, Display Rank & Category
            if clip_item.title and clip_item.title.strip():
                clip_title = clip_item.title.strip()
            else:
                stem = Path(local_path).stem.replace("source_", "").replace("_", " ").title()
                clip_title = stem if len(stem) > 3 else f"Moment #{idx + 1}"

            disp_rank = clip_item.display_rank if getattr(clip_item, "display_rank", None) is not None else (idx + 1)
            cat_val = request.category or getattr(clip_item, "category", None) or "Family Guy"
            char_val = getattr(clip_item, "character", None)

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
                    category=cat_val,
                    source_path=local_path,
                    transcript_path=transcript_json_path,
                )
                db.add(vid_rec)
                db.commit()
                db.refresh(vid_rec)

                cand_rec = ClipCandidate(
                    id=str(uuid.uuid4()),
                    video_id=vid_rec.id,
                    rank_title=f"{disp_rank}. {clip_title}",
                    emoji="🔥",
                    start_time=0.0,
                    end_time=clip_duration,
                    virality_score=max(70, 98 - (idx * 2)),
                    hook_sentence=clip_title,
                    category=cat_val,
                    character_name=char_val,
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
                "rank_title": f"{disp_rank}. {clip_title}",
                "title": f"{disp_rank}. {clip_title}",
                "display_rank": disp_rank,
                "rank_number": disp_rank,
                "category": cat_val,
                "character": char_val,
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
        transition_type = request.transition_type or "swoosh"
        font_family = request.font_family or "minimal"
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
            countdown_order=bool(request.countdown_order),
            transition_type=transition_type,
            font_family=font_family,
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
            "template_type": "ranking",
            "font_family": font_family,
            "category": cat_val,
            "transition_type": transition_type,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
