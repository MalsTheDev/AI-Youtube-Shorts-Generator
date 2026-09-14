"""End-to-end orchestrator.

Two modes:
  * mode="api"   (default) — MuAPI does download / transcribe / LLM / autocrop.
                              Fast, no local deps, pay-per-call.
  * mode="local"            — yt-dlp + faster-whisper + OpenAI or Gemini + ffmpeg/opencv.
                              Self-hosted, LLM_PROVIDER selects OpenAI or Gemini.
"""
import os
from typing import Dict, List, Optional

from .clipper import crop_highlights
from .downloader import download_youtube
from .highlights import call_muapi_llm, get_highlights
from .transcriber import transcribe


def _run_local(
    youtube_url: str,
    num_clips: int,
    aspect_ratio: str,
    download_format: str,
    language: Optional[str],
    out_dir: Optional[str] = None,
    user_prompt: Optional[str] = None,
) -> Dict:
    from .local.clipper import crop_highlights_local
    from .local.downloader import download_youtube_local
    from .local.llm import call_local_llm
    from .local.transcriber import transcribe_local

    source_path = download_youtube_local(youtube_url, fmt=download_format)

    transcript = transcribe_local(source_path, language=language)
    if not transcript["segments"]:
        raise RuntimeError(
            "Whisper produced no segments. The video may have no detectable speech."
        )

    import json
    from pathlib import Path
    from .config import LOCAL_OUTPUT_DIR

    cache_key = f"{Path(source_path).stem}"
    if user_prompt and user_prompt.strip():
        import hashlib
        prompt_hash = hashlib.md5(user_prompt.strip().encode("utf-8")).hexdigest()[:6]
        cache_key += f"_{prompt_hash}"
    highlights_cache_file = os.path.join(LOCAL_OUTPUT_DIR, f"{cache_key}.highlights.json")

    highlights_result = None
    if os.path.exists(highlights_cache_file):
        try:
            with open(highlights_cache_file, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            if cached_data.get("candidates") or cached_data.get("highlights"):
                print(f"[pipeline/local] reusing cached highlights: {highlights_cache_file}", flush=True)
                highlights_result = cached_data
        except Exception as e:
            print(f"[pipeline/local] could not read highlights cache: {e}", flush=True)

    if not highlights_result:
        highlights_result = get_highlights(transcript, num_clips=num_clips, llm_fn=call_local_llm, user_prompt=user_prompt)
        all_highlights: List[Dict] = highlights_result.get("highlights", [])
        if not all_highlights:
            raise RuntimeError("Highlight generator returned zero clips.")
        try:
            with open(highlights_cache_file, "w", encoding="utf-8") as f:
                json.dump({
                    "header_title": highlights_result.get("header_title", "RANKING VIRAL MOMENTS"),
                    "candidates": highlights_result.get("candidates", all_highlights),
                    "highlights": all_highlights,
                }, f, indent=2)
            print(f"[pipeline/local] saved highlights cache: {highlights_cache_file}", flush=True)
        except Exception as e:
            print(f"[pipeline/local] failed to write highlights cache: {e}", flush=True)
    else:
        all_highlights = highlights_result.get("highlights", []) or highlights_result.get("candidates", [])

    top = sorted(all_highlights, key=lambda h: int(h.get("score", 0)), reverse=True)[:num_clips]
    print(f"[pipeline/local] cropping {len(top)} of {len(all_highlights)} candidates", flush=True)

    shorts = crop_highlights_local(source_path, top, aspect_ratio=aspect_ratio, out_dir=out_dir)

    from .local.downloader import get_youtube_video_title
    video_title = get_youtube_video_title(youtube_url)

    return {
        "mode": "local",
        "video_title": video_title,
        "header_title": highlights_result.get("header_title", "RANKING VIRAL MOMENTS"),
        "candidates": highlights_result.get("candidates", all_highlights),
        "source_video_url": source_path,
        "transcript": transcript,
        "highlights": all_highlights,
        "shorts": shorts,
        "user_prompt": user_prompt,
    }


def _run_api(
    youtube_url: str,
    num_clips: int,
    aspect_ratio: str,
    download_format: str,
    language: Optional[str],
    user_prompt: Optional[str] = None,
) -> Dict:
    source_url = download_youtube(youtube_url, fmt=download_format)

    transcript = transcribe(source_url, language=language)
    if not transcript["segments"]:
        raise RuntimeError(
            "Whisper produced no segments. The video may have no detectable speech."
        )

    highlights_result = get_highlights(transcript, num_clips=num_clips, llm_fn=call_muapi_llm, user_prompt=user_prompt)
    all_highlights: List[Dict] = highlights_result.get("highlights", [])
    if not all_highlights:
        raise RuntimeError("Highlight generator returned zero clips.")

    top = sorted(all_highlights, key=lambda h: int(h.get("score", 0)), reverse=True)[:num_clips]
    print(f"[pipeline] cropping {len(top)} of {len(all_highlights)} candidates", flush=True)

    shorts = crop_highlights(source_url, top, aspect_ratio=aspect_ratio)

    return {
        "mode": "api",
        "header_title": highlights_result.get("header_title", "RANKING VIRAL MOMENTS"),
        "candidates": highlights_result.get("candidates", all_highlights),
        "source_video_url": source_url,
        "transcript": transcript,
        "highlights": all_highlights,
        "shorts": shorts,
        "user_prompt": user_prompt,
    }


def generate_shorts(
    youtube_url: str,
    num_clips: int = 3,
    aspect_ratio: str = "9:16",
    download_format: str = "720",
    language: Optional[str] = None,
    mode: Optional[str] = None,
    out_dir: Optional[str] = None,
    user_prompt: Optional[str] = None,
) -> Dict:
    """Run the full pipeline and return a structured result.

    Args:
        youtube_url: source URL.
        num_clips: how many shorts to render.
        aspect_ratio: e.g. "9:16", "1:1".
        download_format: source resolution ("360" / "480" / "720" / "1080").
        language: ISO-639-1 to force Whisper language detection.
        mode: "api" (MuAPI) or "local" (yt-dlp + faster-whisper + OpenAI/Gemini + ffmpeg).
        out_dir: optional destination directory for generated shorts.
        user_prompt: optional custom instructions/focus for highlight detection.

    Returns:
        {
          "mode": "api" | "local",
          "source_video_url": str,   # hosted URL (api) or local path (local)
          "transcript": {...},
          "highlights": [...],       # all candidates ranked
          "shorts": [...],           # top `num_clips` with clip_url / local path
        }
    """
    from .config import MUAPI_API_KEY

    if not mode:
        mode = "api" if MUAPI_API_KEY else "local"
    mode = mode.lower()

    if mode == "api" and not MUAPI_API_KEY:
        print("[pipeline] MUAPI_API_KEY not found, falling back to local mode", flush=True)
        mode = "local"

    if mode == "local":
        return _run_local(
            youtube_url=youtube_url,
            num_clips=num_clips,
            aspect_ratio=aspect_ratio,
            download_format=download_format,
            language=language,
            out_dir=out_dir,
            user_prompt=user_prompt,
        )
    if mode == "api":
        return _run_api(youtube_url, num_clips, aspect_ratio, download_format, language, user_prompt=user_prompt)
    raise ValueError(f"Unknown mode: {mode!r}. Use 'api' or 'local'.")
