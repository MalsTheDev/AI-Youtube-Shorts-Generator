"""Ranking Viral Short Graphics & Fast Rendering Engine.

Composites:
- Background: Full 1080x1920 blurred video (via FFmpeg boxblur=25:5) for 1:1 and 16:9 modes.
- Foreground: Sharp 1:1 square or 16:9 widescreen video frame positioned seamlessly.
- Layer 1 (Top Overlay): Multi-colored bold italic title (Anton font) with black stroke and drop shadow.
- Layer 2 (Middle List): Sequential ranking numbers (1. to 5.) with active clip title revealed in bold white.
- Layer 3 (Captions & Watermark): Centered ASS karaoke subtitles and optional bottom channel handle.
"""
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.path.join(REPO_ROOT, "fonts")
ANTON_FONT_PATH = os.path.join(FONTS_DIR, "Anton-Regular.ttf")
MONTSERRAT_FONT_PATH = os.path.join(FONTS_DIR, "Montserrat-Black.ttf")
DEJAVU_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
NOTO_EMOJI_PATH = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
SWOOSH_SOUND_PATH = os.path.join(REPO_ROOT, "frontend", "swoosh.mp3")

_emoji_font = None
if os.path.exists(NOTO_EMOJI_PATH):
    try:
        _emoji_font = ImageFont.truetype(NOTO_EMOJI_PATH, 109)
    except Exception:
        _emoji_font = None

EMOJI_PATTERN = re.compile(
    r'('
    r'[\U0001F000-\U0001FAFF]'
    r'|[\U0001F300-\U0001F5FF]'
    r'|[\U0001F600-\U0001F64F]'
    r'|[\U0001F680-\U0001F6FF]'
    r'|[\U0001F900-\U0001F9FF]'
    r'|[\u2600-\u27BF]'
    r'|[\u2300-\u23FF]'
    r'|[\u2B50\u2B55]'
    r')[\uFE0E\uFE0F]?'
)

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920

# Rank colors matching viral short reference template
RANK_PALETTE = [
    (255, 238, 0, 255),   # 1. Bright Yellow
    (255, 255, 255, 255), # 2. White
    (255, 102, 0, 255),   # 3. Vibrant Orange
    (255, 255, 255, 255), # 4. White
    (255, 255, 255, 255), # 5. White
    (255, 238, 0, 255),   # 6. Yellow
    (0, 230, 64, 255),    # 7. Green
]


def _render_emoji_glyph(char: str, target_h: int) -> Optional[Image.Image]:
    """Render full-color emoji glyph using NotoColorEmoji with high-quality downsampling."""
    if not _emoji_font:
        return None
    tmp = Image.new("RGBA", (140, 130), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    try:
        d.text((0, 0), char, font=_emoji_font, embedded_color=True)
        bb = tmp.getbbox()
        if bb:
            cr = tmp.crop(bb)
            asp = cr.width / cr.height
            w = max(1, int(round(target_h * asp)))
            return cr.resize((w, target_h), Image.LANCZOS)
    except Exception:
        pass
    return None


def _get_font(size: int, preferred: str = "anton") -> ImageFont.FreeTypeFont:
    candidates = (
        [ANTON_FONT_PATH, MONTSERRAT_FONT_PATH, DEJAVU_FONT_PATH]
        if preferred == "anton"
        else [MONTSERRAT_FONT_PATH, ANTON_FONT_PATH, DEJAVU_FONT_PATH]
    )
    for candidate in candidates:
        if os.path.exists(candidate) and os.path.getsize(candidate) > 1000:
            try:
                return ImageFont.truetype(candidate, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _draw_sheared_line(
    base_img: Image.Image,
    y: int,
    chunks: List[Tuple[str, Tuple[int, int, int, int]]],
    font: ImageFont.FreeTypeFont,
    shear: float = 0.20,
    align: str = "center",
    left_x: int = 90,
    stroke_width: int = 7,
    stroke_color: Tuple[int, int, int, int] = (0, 0, 0, 255),
    shadow_offset: Tuple[int, int] = (5, 8),
    shadow_color: Tuple[int, int, int, int] = (0, 0, 0, 220),
    spacing: int = 14,
) -> int:
    """Draw multi-colored italicized text with heavy outline, full-color emojis, and drop shadow."""
    dummy_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    elements = []
    total_w = 0
    max_h = 0
    target_emoji_h = int(getattr(font, "size", 60) * 0.9)

    for text, col in chunks:
        tokens = [tok for tok in EMOJI_PATTERN.split(text) if tok]
        for tok in tokens:
            if EMOJI_PATTERN.fullmatch(tok):
                e_img = _render_emoji_glyph(tok, target_emoji_h)
                if e_img:
                    elements.append(("emoji", tok, e_img.width, e_img.height, e_img, col))
                    total_w += e_img.width + 8
                    max_h = max(max_h, e_img.height)
                # If emoji cannot be rendered, skip it so FreeType NEVER outputs a tofu box!
            else:
                # Filter any unprintable/surrogate codes that could trigger tofu
                clean_tok = "".join(ch for ch in tok if ord(ch) < 0x2600 or (0x27BF < ord(ch) < 0x1F000))
                if not clean_tok:
                    continue
                bb = dummy_draw.textbbox((0, 0), clean_tok, font=font, stroke_width=stroke_width)
                w = bb[2] - bb[0]
                h = bb[3] - bb[1]
                elements.append(("text", clean_tok, w, h, None, col))
                total_w += w
                max_h = max(max_h, h)
        total_w += spacing

    if total_w > 0:
        total_w -= spacing

    pad_x = 80
    pad_y = 50
    sw = max(10, total_w + pad_x * 2)
    sh = max(10, max_h + pad_y * 2)

    strip = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(strip)

    # 1. Drop shadow pass
    cur_x = pad_x
    for el_type, tok, w, h, img, col in elements:
        if el_type == "text":
            s_draw.text(
                (cur_x + shadow_offset[0], pad_y + shadow_offset[1]),
                tok,
                font=font,
                fill=shadow_color,
                stroke_width=stroke_width,
                stroke_fill=shadow_color,
            )
            cur_x += w
        elif el_type == "emoji" and img:
            sh_img = Image.new("RGBA", img.size, (0, 0, 0, 160))
            sh_img.putalpha(img.split()[-1].point(lambda a: int(a * 0.55)))
            strip.alpha_composite(sh_img, (cur_x + shadow_offset[0] - 2, pad_y + shadow_offset[1] - 3 + (max_h - h) // 2))
            cur_x += w + 8

    # 2. Main content pass
    cur_x = pad_x
    for el_type, tok, w, h, img, col in elements:
        if el_type == "text":
            s_draw.text(
                (cur_x, pad_y),
                tok,
                font=font,
                fill=col,
                stroke_width=stroke_width,
                stroke_fill=stroke_color,
            )
            cur_x += w
        elif el_type == "emoji" and img:
            strip.alpha_composite(img, (cur_x, pad_y + (max_h - h) // 2))
            cur_x += w + 8

    # 3. Shear transform (italic slant)
    sheared = strip.transform(
        (sw, sh),
        Image.AFFINE,
        (1, shear, -shear * (sh / 2), 0, 1, 0),
        Image.BICUBIC,
    )

    if align == "center":
        dest_x = (base_img.width - sw) // 2
    else:
        dest_x = left_x - pad_x

    dest_y = y - pad_y
    base_img.alpha_composite(sheared, (dest_x, dest_y))
    return total_w


def _parse_title_into_chunks(header_title: str) -> Tuple[List[Tuple[str, Tuple[int, int, int, int]]], List[Tuple[str, Tuple[int, int, int, int]]]]:
    """Parse header text into Line 1 and Line 2 with viral styling colors."""
    clean = header_title.strip()
    if not clean:
        clean = "RANKING BEST RANDOM MOMENTS FAMILY GUY"

    # Explicit line breaks via \n or |
    if "\n" in clean or "|" in clean:
        parts = clean.split("\n") if "\n" in clean else clean.split("|")
        line1_text = parts[0].strip().upper()
        line2_text = parts[1].strip().upper() if len(parts) > 1 else ""
    else:
        words = clean.upper().split()
        if len(words) <= 3:
            line1_text = " ".join(words)
            line2_text = ""
        elif len(words) == 4:
            line1_text = " ".join(words[:2])
            line2_text = " ".join(words[2:])
        else:
            mid = len(words) // 2
            line1_text = " ".join(words[:mid])
            line2_text = " ".join(words[mid:])

    # Colorize Line 1
    w1 = line1_text.split()
    line1_chunks = []
    if w1:
        if w1[0] in ("RANKING", "TOP", "THE", "BEST"):
            line1_chunks.append((w1[0], (255, 255, 255, 255)))  # White
            if len(w1) > 1:
                line1_chunks.append((" ".join(w1[1:]), (255, 122, 0, 255)))  # Orange
        else:
            line1_chunks.append((line1_text, (255, 122, 0, 255)))

    # Colorize Line 2
    w2 = line2_text.split()
    line2_chunks = []
    if w2:
        if len(w2) >= 2:
            split_idx = max(1, len(w2) - 2) if len(w2) > 2 else 1
            line2_chunks.append((" ".join(w2[:split_idx]), (255, 122, 0, 255)))
            line2_chunks.append((" ".join(w2[split_idx:]), (0, 230, 64, 255)))
        else:
            line2_chunks.append((line2_text, (0, 230, 64, 255)))

    return line1_chunks, line2_chunks


def generate_rank_overlay_png(
    header_title: str,
    all_clips: List[Dict[str, Any]],
    current_index: int,
    out_path: str,
    layout_mode: str = "1:1",
    channel_handle: Optional[str] = None,
) -> Tuple[str, str]:
    """Generate 1080x1920 base and active overlay PNGs matching viral ranking reference."""
    base_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    active_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))

    title_font = _get_font(74, preferred="anton")
    rank_font = _get_font(62, preferred="anton")
    watermark_font = _get_font(52, preferred="anton")

    dummy_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

    # -------------------------------------------------------------
    # 1. Top Title (Lines 1 and 2) -> Drawn onto base_img
    # -------------------------------------------------------------
    line1_chunks, line2_chunks = _parse_title_into_chunks(header_title)

    y_line1 = 78
    _draw_sheared_line(base_img, y=y_line1, chunks=line1_chunks, font=title_font, align="center")

    if line2_chunks:
        y_line2 = y_line1 + 92
        _draw_sheared_line(base_img, y=y_line2, chunks=line2_chunks, font=title_font, align="center")

    # -------------------------------------------------------------
    # 2. Ranking Numbers & Active / Past Item Titles
    # -------------------------------------------------------------
    max_items = min(len(all_clips), 5)
    start_y = 280 if line2_chunks else 210
    total_avail_height = 700 - start_y
    line_gap = max(70, min(86, total_avail_height // max(1, max_items)))

    for i in range(max_items):
        clip = all_clips[i]
        rank_num_str = f"{i + 1}."
        color = RANK_PALETTE[i % len(RANK_PALETTE)]
        is_current = (i == current_index)
        is_past = (i < current_index)

        item_y = start_y + i * line_gap

        # Measure rank number width for precise title horizontal alignment
        bb_num = dummy_draw.textbbox((0, 0), rank_num_str, font=rank_font, stroke_width=7)
        num_w = bb_num[2] - bb_num[0]
        title_x = 90 + num_w + 16

        raw_title = clip.get("rank_title") or clip.get("title") or f"Moment #{i + 1}"
        # Strip leading numbers like "1. ", "2 - " while preserving full emojis
        clean_title = re.sub(r'^\d+[\.\-\s]+', '', raw_title).strip()
        if len(clean_title) > 32:
            clean_title = clean_title[:30].rstrip() + "..."

        if is_past:
            # Previously revealed clip: draw number + title statically on base_img
            chunks = [(rank_num_str, color), (clean_title, (255, 255, 255, 255))]
            _draw_sheared_line(
                base_img,
                y=item_y,
                chunks=chunks,
                font=rank_font,
                align="left",
                left_x=90,
                spacing=16,
            )
        elif is_current:
            # Active clip: number on base_img, title on active_img for slide-in animation
            _draw_sheared_line(
                base_img,
                y=item_y,
                chunks=[(rank_num_str, color)],
                font=rank_font,
                align="left",
                left_x=90,
                spacing=16,
            )
            _draw_sheared_line(
                active_img,
                y=item_y,
                chunks=[(clean_title, (255, 255, 255, 255))],
                font=rank_font,
                align="left",
                left_x=title_x,
                spacing=16,
            )
        else:
            # Future unrevealed clip: only number on base_img
            _draw_sheared_line(
                base_img,
                y=item_y,
                chunks=[(rank_num_str, color)],
                font=rank_font,
                align="left",
                left_x=90,
                spacing=16,
            )

    # -------------------------------------------------------------
    # 3. Channel Watermark / Handle (Bottom) -> Drawn onto base_img
    # -------------------------------------------------------------
    if channel_handle and channel_handle.strip():
        handle_text = channel_handle.strip()
        if not handle_text.startswith("@"):
            handle_text = f"@{handle_text}"
        _draw_sheared_line(
            base_img,
            y=1830,
            chunks=[(handle_text, (230, 230, 230, 215))],
            font=watermark_font,
            align="center",
            stroke_width=5,
            stroke_color=(0, 0, 0, 180),
            shadow_offset=(3, 5),
            shadow_color=(0, 0, 0, 160),
        )

    # Composite for thumbnail/static previews
    composite = Image.alpha_composite(base_img, active_img)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    composite.save(out_path, "PNG")

    base_path = out_path.replace(".png", "_base.png")
    active_path = out_path.replace(".png", "_active.png")
    base_img.save(base_path, "PNG")
    active_img.save(active_path, "PNG")

    return base_path, active_path


def generate_single_title_overlay_png(
    header_title: str,
    out_path: str,
    layout_mode: str = "1:1",
    channel_handle: Optional[str] = None,
) -> Tuple[str, str]:
    """Generate 1080x1920 single title hook overlay PNG matching the viral spotlight reference image.

    Features:
    1. Prominent centered title hook at the top (white font, thick black stroke & shadow).
    2. Zero ranking numbers, zero ranking list.
    3. Channel watermark handle at the bottom if specified.
    """
    base_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    active_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))

    title_font = _get_font(76, preferred="anton")
    watermark_font = _get_font(52, preferred="anton")

    clean = header_title.strip() if header_title else "BRIAN OWES STEWIE MONEY"

    # Split into 1 or 2 lines if delimited or over 26 characters
    if "\n" in clean or "|" in clean:
        parts = clean.split("\n") if "\n" in clean else clean.split("|")
        line1 = parts[0].strip().upper()
        line2 = parts[1].strip().upper() if len(parts) > 1 else ""
    elif len(clean) > 26:
        words = clean.upper().split()
        mid = len(words) // 2
        line1 = " ".join(words[:mid])
        line2 = " ".join(words[mid:])
    else:
        line1 = clean.upper()
        line2 = ""

    if line2:
        y1 = 95
        y2 = y1 + 95
        _draw_sheared_line(
            base_img,
            y=y1,
            chunks=[(line1, (255, 255, 255, 255))],
            font=title_font,
            shear=0.15,
            align="center",
            stroke_width=9,
            stroke_color=(0, 0, 0, 255),
            shadow_offset=(4, 7),
            shadow_color=(0, 0, 0, 230),
        )
        _draw_sheared_line(
            base_img,
            y=y2,
            chunks=[(line2, (255, 255, 255, 255))],
            font=title_font,
            shear=0.15,
            align="center",
            stroke_width=9,
            stroke_color=(0, 0, 0, 255),
            shadow_offset=(4, 7),
            shadow_color=(0, 0, 0, 230),
        )
    else:
        _draw_sheared_line(
            base_img,
            y=135,
            chunks=[(line1, (255, 255, 255, 255))],
            font=title_font,
            shear=0.15,
            align="center",
            stroke_width=9,
            stroke_color=(0, 0, 0, 255),
            shadow_offset=(4, 7),
            shadow_color=(0, 0, 0, 230),
        )

    # -------------------------------------------------------------
    # Bottom Channel Watermark / Handle
    # -------------------------------------------------------------
    if channel_handle and channel_handle.strip():
        handle_text = channel_handle.strip()
        if not handle_text.startswith("@"):
            handle_text = f"@{handle_text}"
        _draw_sheared_line(
            base_img,
            y=1830,
            chunks=[(handle_text, (230, 230, 230, 215))],
            font=watermark_font,
            shear=0.15,
            align="center",
            stroke_width=5,
            stroke_color=(0, 0, 0, 180),
            shadow_offset=(3, 5),
            shadow_color=(0, 0, 0, 160),
        )

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    base_img.save(out_path, "PNG")

    base_path = out_path.replace(".png", "_base.png")
    active_path = out_path.replace(".png", "_active.png")
    base_img.save(base_path, "PNG")
    active_img.save(active_path, "PNG")

    return base_path, active_path


def format_ass_time(seconds: float) -> str:
    """Format seconds into ASS timestamp: H:MM:SS.cs"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def generate_karaoke_ass(
    transcript: Dict[str, Any],
    clip_start: float,
    clip_end: float,
    out_ass_path: str,
    layout_mode: str = "1:1",
) -> str:
    """Generate ASS subtitle file with compact 1-2 line max styling."""
    if layout_mode == "1:1":
        margin_v = 220
    elif layout_mode == "16:9":
        margin_v = 670
    else:
        margin_v = 280

    ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,DejaVu Sans,54,&H00FFFFFF,&H0000FFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,5,2,2,60,60,{margin_v},1
Style: Default,DejaVu Sans,54,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,5,2,2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    dialogues = []
    segments = transcript.get("segments", []) if transcript else []
    clip_dur = clip_end - clip_start

    for seg in segments:
        s_start = float(seg.get("start", 0))
        s_end = float(seg.get("end", 0))
        if s_end <= clip_start or s_start >= clip_end:
            continue

        words = seg.get("words", [])
        if words:
            # Group word-level tokens into small punchy chunks (max 3-4 words or 24 chars)
            chunks = []
            curr_chunk = []
            curr_len = 0
            for w in words:
                w_text = w.get("word", "").strip()
                if not w_text:
                    continue
                if curr_chunk and (len(curr_chunk) >= 4 or curr_len + len(w_text) + 1 > 24):
                    chunks.append(curr_chunk)
                    curr_chunk = [w]
                    curr_len = len(w_text)
                else:
                    curr_chunk.append(w)
                    curr_len += len(w_text) + 1
            if curr_chunk:
                if len(curr_chunk) == 1 and chunks:
                    chunks[-1].extend(curr_chunk)
                else:
                    chunks.append(curr_chunk)

            for chunk in chunks:
                c_start = float(chunk[0]["start"])
                c_end = float(chunk[-1]["end"])
                if c_end <= clip_start or c_start >= clip_end:
                    continue

                rel_start = max(0.0, c_start - clip_start)
                rel_end = min(clip_dur, c_end - clip_start)
                if rel_end <= rel_start:
                    continue

                t_start = format_ass_time(rel_start)
                t_end = format_ass_time(rel_end)

                karaoke_tokens = []
                for w in chunk:
                    w_start = float(w["start"])
                    w_end = float(w["end"])
                    w_dur_cs = max(10, int(round((w_end - w_start) * 100)))
                    word_clean = w["word"].strip().upper()
                    karaoke_tokens.append(f"{{\\k{w_dur_cs}}}{word_clean} ")

                line_text = "".join(karaoke_tokens).strip()
                dialogues.append(f"Dialogue: 0,{t_start},{t_end},Karaoke,,0,0,0,,{line_text}")
        else:
            # Segment-level text: split into small 3-4 word chunks and interpolate timing
            seg_text = seg.get("text", "").strip()
            if not seg_text:
                continue

            raw_words = seg_text.split()
            if not raw_words:
                continue

            # Chunk into max 3-4 words or max 24 characters to guarantee max 1-2 lines
            chunks = []
            curr_chunk = []
            curr_len = 0
            for rw in raw_words:
                if curr_chunk and (len(curr_chunk) >= 4 or curr_len + len(rw) + 1 > 24):
                    chunks.append(curr_chunk)
                    curr_chunk = [rw]
                    curr_len = len(rw)
                else:
                    curr_chunk.append(rw)
                    curr_len += len(rw) + 1
            if curr_chunk:
                if len(curr_chunk) == 1 and chunks:
                    chunks[-1].extend(curr_chunk)
                else:
                    chunks.append(curr_chunk)

            total_chars = max(1, sum(sum(len(w) for w in c) for c in chunks))
            seg_dur = max(0.2, s_end - s_start)
            c_time = s_start

            for chunk in chunks:
                chunk_chars = sum(len(w) for w in chunk)
                chunk_dur = seg_dur * (chunk_chars / total_chars)
                chunk_start = c_time
                chunk_end = c_time + chunk_dur
                c_time = chunk_end

                if chunk_end <= clip_start or chunk_start >= clip_end:
                    continue

                rel_s = max(0.0, chunk_start - clip_start)
                rel_e = min(clip_dur, chunk_end - clip_start)
                if rel_e <= rel_s:
                    continue

                t_start = format_ass_time(rel_s)
                t_end = format_ass_time(rel_e)
                chunk_text = " ".join(chunk).strip().upper()
                dialogues.append(f"Dialogue: 0,{t_start},{t_end},Default,,0,0,0,,{chunk_text}")

    os.makedirs(os.path.dirname(out_ass_path), exist_ok=True)
    with open(out_ass_path, "w", encoding="utf-8") as f:
        f.write(ass_header + "\n".join(dialogues) + "\n")

    return out_ass_path


def _check_has_audio(file_path: str) -> bool:
    """Check if media file contains an audio stream."""
    try:
        cmd = [
            "ffprobe", "-v", "error", "-select_streams", "a",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0", file_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        return "audio" in res.stdout.lower()
    except Exception:
        return True


def render_single_segment(
    source_path: str,
    clip_info: Dict[str, Any],
    overlay_png: Any,
    ass_path: Optional[str],
    out_path: str,
    layout_mode: str = "1:1",
    active_overlay_png: Optional[str] = None,
) -> str:
    """Render a single segment supporting 1:1, 16:9, or 9:16 layout modes with animations & sound."""
    start_time = float(clip_info["start_time"])
    end_time = float(clip_info["end_time"])
    duration = max(0.5, end_time - start_time)

    # Support passing (base_png, active_png) as overlay_png
    if isinstance(overlay_png, (tuple, list)):
        base_overlay = overlay_png[0]
        if active_overlay_png is None and len(overlay_png) > 1:
            active_overlay_png = overlay_png[1]
    else:
        base_overlay = overlay_png

    has_active = bool(active_overlay_png and os.path.exists(active_overlay_png))
    has_swoosh = bool(os.path.exists(SWOOSH_SOUND_PATH))
    has_source_audio = _check_has_audio(source_path)

    ass_filter = ""
    if ass_path and os.path.exists(ass_path):
        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")
        ass_filter = f",ass='{safe_ass}'"

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{start_time:.3f}",
        "-t", f"{duration:.3f}",
        "-i", source_path,
        "-loop", "1", "-i", base_overlay,
    ]

    if has_active:
        cmd.extend(["-loop", "1", "-i", active_overlay_png])
        if has_swoosh:
            cmd.extend(["-i", SWOOSH_SOUND_PATH])

    if has_active:
        # Subtle clip transition + text appear animation
        if layout_mode == "1:1":
            fg_comp = (
                "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic[v_bg];"
                "[0:v]crop=ih:ih:(iw-ih)/2:0,scale=1080:1080,fade=t=in:st=0:d=0.18:color=white[v_fg];"
                "[v_bg][v_fg]overlay=x='if(lt(t,0.25), 60*pow(1-t/0.25, 2), 0)':y=720[v_comp]"
            )
        elif layout_mode == "16:9":
            fg_comp = (
                "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic[v_bg];"
                "[0:v]scale=1080:608,fade=t=in:st=0:d=0.18:color=white[v_fg];"
                "[v_bg][v_fg]overlay=x='if(lt(t,0.25), 60*pow(1-t/0.25, 2), 0)':y=720[v_comp]"
            )
        else:
            fg_comp = (
                "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,fade=t=in:st=0:d=0.18:color=white[v_comp]"
            )

        video_filter = (
            f"{fg_comp};"
            f"[v_comp][1:v]overlay=0:0[v_base];"
            f"[v_base][2:v]overlay=x='if(lt(t,0.35), -800*pow(1-t/0.35, 2), 0)':y=0{ass_filter}[v_out]"
        )

        if has_swoosh and has_source_audio:
            audio_filter = (
                ";[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a0];"
                "[3:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.85[a1];"
                "[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a_out]"
            )
            filter_complex = f"{video_filter}{audio_filter}"
            audio_map = ["[a_out]"]
        elif has_swoosh and not has_source_audio:
            audio_filter = (
                ";[3:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.85[a_out]"
            )
            filter_complex = f"{video_filter}{audio_filter}"
            audio_map = ["[a_out]"]
        else:
            filter_complex = video_filter
            audio_map = ["0:a:0?"]
    else:
        # Fallback static
        if layout_mode == "1:1":
            filter_complex = (
                "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic[v_bg];"
                "[0:v]crop=ih:ih:(iw-ih)/2:0,scale=1080:1080[v_fg];"
                f"[v_bg][v_fg]overlay=0:720[v_comp];"
                f"[v_comp][1:v]overlay=0:0{ass_filter}[v_out]"
            )
        elif layout_mode == "16:9":
            filter_complex = (
                "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic[v_bg];"
                "[0:v]scale=1080:608[v_fg];"
                f"[v_bg][v_fg]overlay=0:720[v_comp];"
                f"[v_comp][1:v]overlay=0:0{ass_filter}[v_out]"
            )
        else:
            filter_complex = (
                "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2[v_bg];"
                f"[v_bg][1:v]overlay=0:0{ass_filter}[v_out]"
            )
        audio_map = ["0:a:0?"]

    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "[v_out]",
        "-map", audio_map[0],
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-threads", "0",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        "-t", f"{duration:.3f}",
        "-movflags", "+faststart",
        out_path,
    ])
    subprocess.run(cmd, check=True)
    return out_path


def render_ranking_short(
    source_video_path: str,
    transcript: Dict[str, Any],
    header_title: str,
    selected_clips: List[Dict[str, Any]],
    work_dir: str,
    final_output_path: str,
    layout_mode: str = "1:1",
    channel_handle: Optional[str] = None,
    captions_enabled: bool = True,
    progress_callback: Optional[Any] = None,
    template_type: str = "ranking",
) -> str:
    """Full pipeline: composites multiple clips into final_short.mp4 supporting ranking and single_title templates."""
    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(os.path.dirname(final_output_path), exist_ok=True)

    # Clean stale segment/overlay files from previous renders to prevent Frankenstein outputs
    import glob
    for stale in glob.glob(os.path.join(work_dir, "seg_*.mp4")):
        try:
            os.remove(stale)
        except OSError:
            pass

    segment_paths: List[str] = []

    for idx, clip in enumerate(selected_clips):
        clip_title = clip.get('rank_title') or clip.get('title') or f"Clip #{idx + 1}"
        clip_src_dbg = clip.get('source_video_path') or clip.get('source_path') or 'fallback'
        print(f"[render_engine] Processing Clip #{idx + 1}/{len(selected_clips)}: {clip_title}  [src={os.path.basename(str(clip_src_dbg))}, {clip.get('start_time')}-{clip.get('end_time')}s]", flush=True)
        if progress_callback:
            try:
                progress_callback(idx + 1, len(selected_clips), clip_title)
            except RuntimeError:
                raise  # Propagate cancellation signals
            except Exception:
                pass  # Ignore non-critical callback errors
        seg_out = os.path.join(work_dir, f"seg_{idx + 1:02d}.mp4")
        overlay_png = os.path.join(work_dir, f"overlay_{idx + 1:02d}.png")
        ass_path: Optional[str] = None

        # 1. Generate PIL overlay PNG based on template_type
        if template_type == "single_title":
            base_png, active_png = generate_single_title_overlay_png(
                header_title=header_title,
                out_path=overlay_png,
                layout_mode=layout_mode,
                channel_handle=channel_handle,
            )
        else:
            base_png, active_png = generate_rank_overlay_png(
                header_title=header_title,
                all_clips=selected_clips,
                current_index=idx,
                out_path=overlay_png,
                layout_mode=layout_mode,
                channel_handle=channel_handle,
            )

        clip_source = clip.get("source_video_path") or clip.get("source_path") or source_video_path
        # Ensure absolute path for reliable FFmpeg input
        if clip_source and not os.path.isabs(clip_source):
            clip_source = os.path.abspath(clip_source)
        clip_transcript = clip.get("transcript") or transcript

        # 2. Generate ASS subtitles only if captions are enabled
        if captions_enabled and clip_transcript:
            ass_candidate = os.path.join(work_dir, f"subtitles_{idx + 1:02d}.ass")
            generate_karaoke_ass(
                transcript=clip_transcript,
                clip_start=float(clip["start_time"]),
                clip_end=float(clip["end_time"]),
                out_ass_path=ass_candidate,
                layout_mode=layout_mode,
            )
            if os.path.exists(ass_candidate):
                ass_path = ass_candidate

        # 3. Render segment with FFmpeg
        render_single_segment(
            source_path=clip_source,
            clip_info=clip,
            overlay_png=base_png,
            active_overlay_png=active_png,
            ass_path=ass_path,
            out_path=seg_out,
            layout_mode=layout_mode,
        )
        segment_paths.append(seg_out)

    if len(segment_paths) == 1:
        import shutil
        shutil.copyfile(segment_paths[0], final_output_path)
    else:
        # Build filter_complex concat — properly resets PTS/DTS for each segment,
        # eliminating AAC priming delay accumulation that causes A/V desync.
        n = len(segment_paths)
        inputs = []
        for seg in segment_paths:
            inputs.extend(["-i", os.path.abspath(seg)])

        # Build [0:v][0:a][1:v][1:a]...concat=n=N:v=1:a=1[vout][aout]
        stream_labels = "".join(f"[{i}:v][{i}:a]" for i in range(n))
        filter_str = f"{stream_labels}concat=n={n}:v=1:a=1[vout][aout]"

        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
        ] + inputs + [
            "-filter_complex", filter_str,
            "-map", "[vout]",
            "-map", "[aout]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            final_output_path,
        ]
        subprocess.run(cmd, check=True)

    print(f"[render_engine] Successfully compiled final short: {final_output_path}", flush=True)
    return final_output_path
