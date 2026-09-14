"""Find the most viral-worthy highlights in a transcript.

Logic ported from ViralVadoo's transcript_analysis/highlight_generator.py:
  - content-type / density detection
  - chunking for long videos with overlap
  - virality-criteria prompt
  - score-based dedupe with overlap suppression

The LLM call is pluggable via the `llm_fn` argument so the same prompts can
drive either MuAPI (default, --mode api) or a direct local LLM client
(--mode local).
"""
import json
import re
from typing import Callable, Dict, List, Optional

from . import muapi


LLMFn = Callable[[str], str]


CONTENT_TYPE_PROMPT = """Analyze this video transcript sample and classify the content type.
Choose one: podcast, interview, tutorial, lecture, commentary, debate, vlog, other.
Also estimate content density: low (mostly filler/chit-chat), medium, or high (dense info/stories).
Respond with JSON only: {"content_type": "...", "density": "..."}"""


VIRALITY_CRITERIA = """
Virality signals to prioritize (ranked by impact):
1. HOOK MOMENTS — statements that create immediate curiosity ("The secret is...", "Nobody talks about...", "I was completely wrong about...")
2. EMOTIONAL PEAKS — genuine surprise, laughter, anger, vulnerability, excitement; raw unscripted reactions
3. OPINION BOMBS — strong, polarizing or counter-intuitive statements that trigger agree/disagree
4. REVELATION MOMENTS — surprising facts, stats, or confessions that reframe how the viewer thinks
5. CONFLICT/TENSION — disagreement, pushback, or a problem being confronted head-on
6. QUOTABLE ONE-LINERS — a sentence that works as a standalone quote card
7. STORY PEAKS — the climax or twist of an anecdote; the payoff moment
8. PRACTICAL VALUE — a concrete tip, hack, or insight the viewer can immediately apply
"""


HIGHLIGHT_SYSTEM_PROMPT = """You are an elite short-form video editor specialized in creating viral "Ranking Viral Shorts" (TikTok, Instagram Reels, YouTube Shorts).
You transform long videos into punchy ranked lists (e.g. "RANKING BEST RANDOM MOMENTS", "TOP 10 FUNNIEST MOMENTS").

{virality_criteria}
{prompt_guidance}
Content type: {content_type} | Density: {density}

Your task:
1. Provide a punchy ALL-CAPS header title for the ranking video (e.g. "RANKING BEST RANDOM MOMENTS", "TOP 10 FUNNIEST MOMENTS", or if user instructions specify a subject/character/topic, tailor the title directly to it, e.g. "RANKING BEST STEWIE MOMENTS", "RANKING TOP FIGHTS", etc.).
2. Identify the top funniest and most viral candidate moments matching any focus instruction (target: {num_clips} candidate moments).
3. For each candidate moment, provide:
   - "id": integer (1, 2, 3...)
   - "rank_title": a short, hilarious rank item description ending with an appropriate emoji (e.g. "Peter at KFC Cashier 🐔", "Quagmire's Driving Test 🚗")
   - "start_time": precise float start second
   - "end_time": precise float end second (sweet spot: 15-60 seconds for fast ranking pacing)
   - "hook_sentence": the single best opening line that grabs attention immediately
   - "virality_score": score from 80-100 indicating viral potential
   - "virality_reason": why this moment is hilarious or viral

Rules:
- Never cut mid-sentence or mid-word
- Moments must feel complete and self-contained
- Do not duplicate or heavily overlap moments
{prompt_rules}
Respond ONLY with valid JSON (no markdown, no code fences):
{{"header_title": "RANKING BEST RANDOM MOMENTS", "candidates": [{{"id": 1, "rank_title": "Peter at KFC Cashier 🐔", "start_time": 10.0, "end_time": 25.5, "hook_sentence": "string", "virality_score": 95, "virality_reason": "string"}}]}}"""


CHUNK_SIZE_SECONDS = 1200       # 20-min chunks for long videos
LONG_VIDEO_THRESHOLD = 1800     # chunk videos longer than 30 min
CHUNK_OVERLAP_SECONDS = 60
GPT_CALL_TIMEOUT_SECONDS = 300  # cap LLM polls at 5 min — a wedged call should fail fast
MAX_HIGHLIGHT_API_ATTEMPTS = 3


def call_muapi_llm(prompt: str) -> str:
    """Default LLM backend: MuAPI gpt-5-mini."""
    result = muapi.run(
        "gpt-5-mini",
        {"prompt": prompt},
        label="gpt-5-mini",
        timeout=GPT_CALL_TIMEOUT_SECONDS,
    )

    outputs = result.get("outputs")
    if isinstance(outputs, list) and outputs and isinstance(outputs[0], str) and outputs[0].strip():
        return outputs[0]

    for key in ("output", "text", "response", "result", "content"):
        v = result.get(key)
        if isinstance(v, str) and v.strip():
            return v
        if isinstance(v, dict):
            inner = v.get("text") or v.get("content")
            if isinstance(inner, str) and inner.strip():
                return inner
        if isinstance(v, list) and v and isinstance(v[0], str):
            return v[0]

    raise RuntimeError(f"Could not extract gpt-5-mini text from response: {result}")


def _parse_json_loose(raw: str) -> Dict:
    """gpt-5-4 sometimes wraps JSON in markdown fences — strip and parse."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return json.loads(text[start:end + 1])
        raise


def _coerce_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: object, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _sanitize_highlights(raw_highlights: object, duration: float) -> List[Dict]:
    """Normalize model output into the expected shape; skip invalid entries."""
    if not isinstance(raw_highlights, list):
        return []

    max_end = duration if duration > 0 else float("inf")
    cleaned: List[Dict] = []
    for item in raw_highlights:
        if not isinstance(item, dict):
            continue

        start = _coerce_float(item.get("start_time"), default=-1.0)
        end = _coerce_float(item.get("end_time"), default=-1.0)
        if start < 0:
            continue
        if end <= start:
            # If end is missing or <= start, assume a default 30s duration
            end = start + 30.0

        if max_end != float("inf") and max_end > 0:
            # If start is already past max_end, it might be an absolute timestamp on a chunk, keep it within bounds if possible
            if start >= max_end:
                continue
            end = min(end, max_end)
            if end <= start:
                continue

        rank_title = str(item.get("rank_title") or item.get("title") or f"Moment #{len(cleaned) + 1}").strip()
        score = max(0, min(100, _coerce_int(item.get("virality_score") or item.get("score"), default=90)))
        cand_id = str(item.get("id") or f"cand_{len(cleaned) + 1}")

        cleaned.append(
            {
                "id": cand_id,
                "rank_title": rank_title,
                "title": rank_title,
                "start_time": round(start, 2),
                "end_time": round(end, 2),
                "score": score,
                "virality_score": score,
                "hook_sentence": str(item.get("hook_sentence") or "").strip(),
                "virality_reason": str(item.get("virality_reason") or "").strip(),
            }
        )

    return cleaned


def detect_content_type(transcript: Dict, llm_fn: LLMFn = call_muapi_llm) -> Dict[str, str]:
    segments = transcript.get("segments", [])
    sample = " ".join(s["text"] for s in segments[:25])[:3000]
    prompt = f"{CONTENT_TYPE_PROMPT}\n\nTranscript sample:\n{sample}"
    try:
        raw = llm_fn(prompt)
        return _parse_json_loose(raw)
    except Exception:
        return {"content_type": "other", "density": "medium"}


def build_transcript_text(transcript: Dict) -> str:
    segments = transcript.get("segments", [])
    offset = float(transcript.get("_offset", 0.0) or 0.0)
    return "\n".join(f"[{max(0.0, float(s['start']) - offset):.1f}s] {s['text'].strip()}" for s in segments)


def chunk_transcript(transcript: Dict) -> List[Dict]:
    segments = transcript.get("segments", [])
    duration = transcript.get("duration", segments[-1]["end"] if segments else 0)
    chunks = []
    start = 0
    while start < duration:
        end = min(start + CHUNK_SIZE_SECONDS, duration)
        chunk_segs = [
            s for s in segments
            if s["start"] >= start and s["end"] <= end + CHUNK_OVERLAP_SECONDS
        ]
        if chunk_segs:
            chunk = dict(transcript)
            chunk["segments"] = chunk_segs
            chunk["duration"] = end - start
            chunk["_offset"] = start
            chunks.append(chunk)
        start += CHUNK_SIZE_SECONDS - CHUNK_OVERLAP_SECONDS
    return chunks


def call_highlight_api(
    transcript_text: str,
    content_info: Dict,
    duration: float,
    num_clips: int,
    is_chunk: bool = False,
    llm_fn: LLMFn = call_muapi_llm,
    user_prompt: Optional[str] = None,
) -> Dict:
    prompt_guidance = ""
    prompt_rules = ""
    if user_prompt and user_prompt.strip():
        clean_user_prompt = user_prompt.strip()
        prompt_guidance = f"""
🎯 CRITICAL USER FOCUS INSTRUCTION:
The user explicitly specified: "{clean_user_prompt}"
You MUST strictly prioritize and extract moments that match this instruction above general virality.
Every moment selected must focus on or prominently feature: "{clean_user_prompt}".
Search the ENTIRE transcript and extract as many matching moments as possible (up to {max(5, num_clips)}).
Ensure the "header_title" directly reflects this topic (e.g. if the user wants Stewie moments, the title must be like "RANKING BEST STEWIE MOMENTS").
"""
        prompt_rules = f"- Every single candidate moment MUST match the user focus: \"{clean_user_prompt}\"\n"

    system = HIGHLIGHT_SYSTEM_PROMPT.format(
        virality_criteria=VIRALITY_CRITERIA,
        prompt_guidance=prompt_guidance,
        prompt_rules=prompt_rules,
        content_type=content_info.get("content_type", "other"),
        density=content_info.get("density", "medium"),
        num_clips=max(10, num_clips),
    )
    base_prompt = f"{system}\n\nTranscript:\n{transcript_text}"
    prompt = base_prompt
    last_error = "unknown"

    for attempt in range(1, MAX_HIGHLIGHT_API_ATTEMPTS + 1):
        raw = llm_fn(prompt)
        try:
            parsed = _parse_json_loose(raw)
            if isinstance(parsed, list):
                raw_candidates = parsed
                header_title = "RANKING VIRAL MOMENTS"
            else:
                header_title = str(parsed.get("header_title") or "RANKING VIRAL MOMENTS").strip()
                raw_candidates = (
                    parsed.get("candidates")
                    or parsed.get("highlights")
                    or parsed.get("shorts")
                    or parsed.get("moments")
                    or []
                )
            candidates = _sanitize_highlights(raw_candidates, duration=duration)
            if candidates:
                return {
                    "header_title": header_title,
                    "candidates": candidates,
                    "highlights": candidates,
                }
            last_error = "no valid candidates in response"
        except Exception as e:
            last_error = str(e)

        if attempt < MAX_HIGHLIGHT_API_ATTEMPTS:
            print(
                f"[highlights] invalid model output on attempt {attempt}/{MAX_HIGHLIGHT_API_ATTEMPTS}; retrying: {last_error}",
                flush=True,
            )
            prompt = (
                base_prompt
                + "\n\nIMPORTANT: Return ONLY valid JSON with 'header_title' (string) and 'candidates' array."
                + " Each item must include: id, rank_title, start_time, end_time, virality_score, hook_sentence, virality_reason."
                + " No markdown fences, no commentary."
            )

    raise RuntimeError(
        f"Highlight generator produced invalid output after {MAX_HIGHLIGHT_API_ATTEMPTS} attempts: {last_error}"
    )


def dedupe_highlights(highlights: List[Dict]) -> List[Dict]:
    """Drop a highlight if it overlaps >50% with a higher-scoring one already kept."""
    highlights = sorted(highlights, key=lambda x: int(x.get("score", 0)), reverse=True)
    kept: List[Dict] = []
    for h in highlights:
        h_start = float(h["start_time"])
        h_end = float(h["end_time"])
        h_dur = h_end - h_start
        overlapping = False
        for k in kept:
            latest_start = max(h_start, float(k["start_time"]))
            earliest_end = min(h_end, float(k["end_time"]))
            overlap = earliest_end - latest_start
            if overlap > 0 and overlap > 0.5 * h_dur:
                overlapping = True
                break
        if not overlapping:
            kept.append(h)
    return kept


def get_highlights(
    transcript: Dict,
    num_clips: int = 10,
    llm_fn: Optional[LLMFn] = None,
    user_prompt: Optional[str] = None,
) -> Dict:
    """Main entry point — returns {header_title, candidates, highlights} sorted by score.

    `llm_fn` swaps the underlying LLM. Defaults to MuAPI gpt-5-mini; local
    mode passes in a local LLM-backed callable.
    `user_prompt` allows guiding the AI to extract specific characters/themes/moments.
    """
    llm_fn = llm_fn or call_muapi_llm
    duration = transcript.get("duration", 0)
    content_info = detect_content_type(transcript, llm_fn=llm_fn)
    print(f"[highlights] content={content_info.get('content_type')} density={content_info.get('density')} duration={duration:.0f}s prompt={user_prompt!r}", flush=True)

    header_title = "RANKING VIRAL MOMENTS"
    if duration >= LONG_VIDEO_THRESHOLD:
        chunks = chunk_transcript(transcript)
        print(f"[highlights] long video — splitting into {len(chunks)} chunks", flush=True)
        all_highlights: List[Dict] = []
        for i, chunk in enumerate(chunks):
            offset = chunk.get("_offset", 0)
            text = build_transcript_text(chunk)
            print(f"[highlights] chunk {i + 1}/{len(chunks)} (offset {offset:.0f}s)", flush=True)
            result = call_highlight_api(text, content_info, chunk["duration"], num_clips=num_clips, is_chunk=True, llm_fn=llm_fn, user_prompt=user_prompt)
            if result.get("header_title"):
                header_title = result["header_title"]
            for h in result.get("candidates", []) or result.get("highlights", []):
                h["start_time"] = float(h["start_time"]) + offset
                h["end_time"] = float(h["end_time"]) + offset
                all_highlights.append(h)
        highlights = dedupe_highlights(all_highlights)
    else:
        text = build_transcript_text(transcript)
        result = call_highlight_api(text, content_info, duration, num_clips=num_clips, llm_fn=llm_fn, user_prompt=user_prompt)
        if result.get("header_title"):
            header_title = result["header_title"]
        highlights = dedupe_highlights(result.get("candidates", []) or result.get("highlights", []))

    # Re-index candidates 1 to N
    for idx, c in enumerate(highlights, 1):
        c["id"] = f"cand_{idx}"
        c["rank"] = idx

    return {
        "header_title": header_title,
        "candidates": highlights[:num_clips],
        "highlights": highlights[:num_clips],
    }
