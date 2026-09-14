"""Local transcription via faster-whisper.

Reads a local media file and returns the same shape the highlight generator
expects: {duration, segments[start, end, text]}.
"""
import os
import re
from pathlib import Path
from typing import Dict, List, Optional

from ..config import LOCAL_OUTPUT_DIR, LOCAL_WHISPER_DEVICE, LOCAL_WHISPER_MODEL


def _transcript_cache_path(media_path: str) -> Path:
    """Return the .srt cache path for a media file."""
    cache_dir = Path(LOCAL_OUTPUT_DIR)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / (Path(media_path).stem + ".srt")


def _transcript_json_cache_path(media_path: str) -> Path:
    """Return the .json cache path for word-level timestamps."""
    cache_dir = Path(LOCAL_OUTPUT_DIR)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / (Path(media_path).stem + ".transcript.json")


def _format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _parse_srt_timestamp(value: str) -> float:
    match = re.fullmatch(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})", value.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp: {value!r}")
    hours, minutes, seconds, millis = map(int, match.groups())
    return hours * 3600 + minutes * 60 + seconds + (millis / 1000.0)


def _write_srt_cache(media_path: str, transcript: Dict) -> Path:
    cache_path = _transcript_cache_path(media_path)
    lines = []
    for idx, segment in enumerate(transcript.get("segments", []), start=1):
        start = _format_srt_timestamp(float(segment["start"]))
        end = _format_srt_timestamp(float(segment["end"]))
        text = str(segment.get("text", "")).strip().replace("\r", "").replace("\n", " ")
        lines.append(str(idx))
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")

    cache_path.write_text("\n".join(lines), encoding="utf-8")

    # Also save full JSON cache with word timestamps
    try:
        import json
        json_path = _transcript_json_cache_path(media_path)
        json_path.write_text(json.dumps(transcript, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[transcribe/local] could not save json cache: {e}", flush=True)

    return cache_path


def _synthesize_words(segment: Dict) -> List[Dict]:
    """Fallback word-level timestamp synthesis for segments lacking word arrays."""
    text = segment.get("text", "").strip()
    words = text.split()
    if not words:
        return []
    start = float(segment["start"])
    end = float(segment["end"])
    dur = max(0.1, end - start)
    total_chars = sum(max(1, len(w)) for w in words)
    cur_t = start
    res = []
    for w in words:
        w_dur = (len(w) / total_chars) * dur
        res.append({
            "word": w,
            "start": round(cur_t, 2),
            "end": round(cur_t + w_dur, 2),
        })
        cur_t += w_dur
    return res


def _load_srt_cache(cache_path: Path) -> Dict:
    content = cache_path.read_text(encoding="utf-8-sig").strip()
    if not content:
        return {"duration": 0.0, "segments": []}

    segments = []
    for block in re.split(r"\n\s*\n", content):
        lines = [line.strip("\ufeff") for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        if "-->" not in lines[0] and len(lines) > 1 and "-->" in lines[1]:
            lines = lines[1:]
        if not lines or "-->" not in lines[0]:
            continue
        start_raw, end_raw = [part.strip() for part in lines[0].split("-->", 1)]
        text = "\n".join(lines[1:]).strip()
        segments.append(
            {
                "start": _parse_srt_timestamp(start_raw),
                "end": _parse_srt_timestamp(end_raw),
                "text": text,
            }
        )

    duration = segments[-1]["end"] if segments else 0.0
    return {"duration": duration, "segments": segments}


def _resolve_device() -> str:
    if LOCAL_WHISPER_DEVICE != "auto":
        return LOCAL_WHISPER_DEVICE
    try:
        import torch  # type: ignore
        if torch.cuda.is_available():
            # Test that CUDA actually works (catches missing cuBLAS/cuDNN libs)
            torch.zeros(1, device="cuda")
            return "cuda"
    except (ImportError, OSError, RuntimeError):
        pass
    return "cpu"


def transcribe_local(media_path: str, language: Optional[str] = None) -> Dict:
    """Run faster-whisper on a local file path, caching the result as .srt and .json."""
    json_cache_path = _transcript_json_cache_path(media_path)
    cache_path = _transcript_cache_path(media_path)

    # 1. Check if JSON cache with word timestamps exists
    if json_cache_path.exists():
        source_mtime = os.path.getmtime(media_path)
        if json_cache_path.stat().st_mtime >= source_mtime:
            try:
                import json
                cached = json.loads(json_cache_path.read_text(encoding="utf-8"))
                if cached.get("segments") and cached.get("duration", 0) > 0:
                    print(f"[transcribe/local] reusing cached JSON transcript with words: {json_cache_path}", flush=True)
                    return cached
            except Exception as e:
                print(f"[transcribe/local] could not read json cache: {e}", flush=True)

    # 2. Check if SRT cache exists
    if cache_path.exists():
        source_mtime = os.path.getmtime(media_path)
        cache_mtime = cache_path.stat().st_mtime
        if cache_mtime >= source_mtime:
            print(f"[transcribe/local] reusing cached transcript: {cache_path}", flush=True)
            cached = _load_srt_cache(cache_path)
            if not cached["segments"] or cached["duration"] <= 0.0:
                print(f"[transcribe/local] cache is empty/invalid, deleting: {cache_path}", flush=True)
                cache_path.unlink(missing_ok=True)
            else:
                # Ensure each segment has word-level timestamps
                for seg in cached["segments"]:
                    if "words" not in seg or not seg["words"]:
                        seg["words"] = _synthesize_words(seg)
                print(
                    f"[transcribe/local] {len(cached['segments'])} cached segments, "
                    f"{cached['duration']:.0f}s of audio",
                    flush=True,
                )
                return cached

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "faster-whisper is required for --mode local. Install it with:\n"
            "    pip install -r requirements-local.txt"
        ) from e

    device = _resolve_device()
    compute_type = "int8"
    print(f"[transcribe/local] faster-whisper model={LOCAL_WHISPER_MODEL} device={device} compute_type={compute_type} cpu_threads=4", flush=True)

    from ..config import LOCAL_WHISPER_VAD_FILTER, LOCAL_WHISPER_VAD_PARAMETERS

    model = WhisperModel(
        LOCAL_WHISPER_MODEL,
        device=device,
        compute_type=compute_type,
        cpu_threads=4,
    )

    transcribe_kwargs = {
        "audio": media_path,
        "language": language,
        "beam_size": 1,  # Ultra-fast decoding
        "word_timestamps": True,
        "condition_on_previous_text": False,
    }
    if LOCAL_WHISPER_VAD_FILTER:
        transcribe_kwargs["vad_filter"] = True
        transcribe_kwargs["vad_parameters"] = LOCAL_WHISPER_VAD_PARAMETERS
    else:
        transcribe_kwargs["vad_filter"] = False

    segments_iter, info = model.transcribe(**transcribe_kwargs)

    segments = []
    for s in segments_iter:
        seg_dict = {
            "start": float(s.start),
            "end": float(s.end),
            "text": (s.text or "").strip(),
        }
        if hasattr(s, "words") and s.words:
            seg_dict["words"] = [
                {
                    "start": float(w.start),
                    "end": float(w.end),
                    "word": (w.word or "").strip(),
                }
                for w in s.words
            ]
        else:
            seg_dict["words"] = _synthesize_words(seg_dict)
        segments.append(seg_dict)

    duration = float(getattr(info, "duration", 0.0)) or (segments[-1]["end"] if segments else 0.0)
    print(f"[transcribe/local] {len(segments)} segments, {duration:.0f}s of audio", flush=True)
    transcript = {"duration": duration, "segments": segments}
    cache_path = _write_srt_cache(media_path, transcript)
    print(f"[transcribe/local] wrote cache: {cache_path}", flush=True)
    return transcript
