"""Local YouTube download via yt-dlp.

Returns a local mp4 path so the rest of the local pipeline can read it
directly off disk.
"""
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from typing import Optional

from ..config import LOCAL_OUTPUT_DIR


def _import_ytdlp():
    try:
        import yt_dlp  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "yt-dlp is required for --mode local. Install it with:\n"
            "    pip install -r requirements-local.txt"
        ) from e
    return yt_dlp


def _format_for(fmt: str) -> str:
    """Map our '720' / '1080' shorthand to a yt-dlp format selector."""
    try:
        height = int(fmt)
    except ValueError:
        height = 720
    return (
        f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
        f"best[height<={height}][ext=mp4]/best"
    )


def _extract_youtube_video_id(source: str) -> Optional[str]:
    """Best-effort extraction of a YouTube video id from a URL."""
    parsed = urlparse(source)
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]

    if host in ("youtu.be", "www.youtu.be"):
        video_id = parsed.path.lstrip("/").split("/", 1)[0]
        return video_id or None

    if "youtube.com" in host:
        if parsed.path.startswith("/watch"):
            qs = parse_qs(parsed.query)
            video_id = qs.get("v", [""])[0]
            return video_id or None
        match = re.search(r"/(?:shorts|embed|live)/([^/?#&]+)", parsed.path)
        if match:
            return match.group(1)

    return None


def _resolve_local_path(source: str) -> Optional[str]:
    """Return a local filesystem path if the input already points at one."""
    parsed = urlparse(source)
    if parsed.scheme == "file":
        raw_path = unquote(parsed.path)
        if parsed.netloc and parsed.netloc not in ("", "localhost"):
            raw_path = f"//{parsed.netloc}{raw_path}"
        candidate = Path(raw_path).expanduser()
        if candidate.exists() and candidate.is_file():
            return str(candidate.resolve())
        raise RuntimeError(f"Local file URL does not exist: {source}")

    if parsed.scheme in ("http", "https"):
        return None

    candidate = Path(source).expanduser()
    if candidate.exists() and candidate.is_file():
        return str(candidate.resolve())

    if any(sep in source for sep in (os.sep, "/")) or source.startswith("~") or source.startswith("."):
        raise RuntimeError(f"Local file path does not exist: {source}")

    return None


def _existing_download(out_dir: str, video_id: str) -> Optional[str]:
    """Return a cached download path if we already have this YouTube id."""
    for ext in (".mp4", ".mkv", ".webm"):
        candidate = os.path.join(out_dir, f"source_{video_id}{ext}")
        if os.path.exists(candidate):
            return candidate
    return None


def download_youtube_local(video_url: str, fmt: str = "720", out_dir: Optional[str] = None) -> str:
    """Download a remote URL or return a local file path unchanged."""
    local_path = _resolve_local_path(video_url)
    if local_path:
        print(f"[download/local] using local file: {local_path}", flush=True)
        return local_path

    yt_dlp = _import_ytdlp()
    out_dir = out_dir or LOCAL_OUTPUT_DIR
    os.makedirs(out_dir, exist_ok=True)

    video_id = _extract_youtube_video_id(video_url)
    if video_id:
        cached = _existing_download(out_dir, video_id)
        if cached:
            print(f"[download/local] reusing cached download: {cached}", flush=True)
            return cached

    print(f"[download/local] {video_url} @ {fmt}p → {out_dir}/", flush=True)
    ydl_opts = {
        "format": _format_for(fmt),
        "outtmpl": os.path.join(out_dir, "source_%(id)s.%(ext)s"),
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        path = ydl.prepare_filename(info)
        # merge_output_format may rename the extension after merge
        if not os.path.exists(path):
            stem, _ = os.path.splitext(path)
            for ext in (".mp4", ".mkv", ".webm"):
                if os.path.exists(stem + ext):
                    path = stem + ext
                    break

        # Cache metadata including actual YouTube video title
        try:
            actual_vid = info.get("id") or video_id
            if actual_vid:
                meta_path = os.path.join(out_dir, f"source_{actual_vid}.info.json")
                import json
                with open(meta_path, "w", encoding="utf-8") as mf:
                    json.dump({
                        "id": actual_vid,
                        "title": info.get("title") or f"Video ({actual_vid})",
                        "duration": info.get("duration", 0.0),
                        "channel": info.get("uploader") or info.get("channel"),
                    }, mf, indent=2)
        except Exception as e:
            print(f"[download/local] warning: could not cache info.json: {e}", flush=True)

    print(f"[download/local] ready: {path}", flush=True)
    return path


def get_youtube_video_title(video_url: str, out_dir: Optional[str] = None) -> str:
    """Safely retrieves the actual YouTube video title from disk cache or yt-dlp metadata."""
    if not video_url:
        return "YouTube Video"

    out_dir = out_dir or LOCAL_OUTPUT_DIR
    video_id = _extract_youtube_video_id(video_url)

    if video_id:
        meta_path = os.path.join(out_dir, f"source_{video_id}.info.json")
        if os.path.exists(meta_path):
            try:
                import json
                with open(meta_path, "r", encoding="utf-8") as mf:
                    data = json.load(mf)
                    if data.get("title"):
                        return data["title"]
            except Exception:
                pass

    # Query yt-dlp metadata without downloading
    try:
        yt_dlp = _import_ytdlp()
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            title = info.get("title") if info else None
            if title:
                if video_id:
                    os.makedirs(out_dir, exist_ok=True)
                    meta_path = os.path.join(out_dir, f"source_{video_id}.info.json")
                    try:
                        import json
                        with open(meta_path, "w", encoding="utf-8") as mf:
                            json.dump({
                                "id": video_id,
                                "title": title,
                                "duration": info.get("duration", 0.0),
                                "channel": info.get("uploader") or info.get("channel"),
                            }, mf, indent=2)
                    except Exception:
                        pass
                return title
    except Exception as e:
        print(f"[download/title] error fetching title for {video_url}: {e}", flush=True)

    return f"Video ({video_id})" if video_id else "YouTube Video"

