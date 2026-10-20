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
INTER_FONT_PATH = os.path.join(FONTS_DIR, "Inter-Bold.ttf")
LIBERATION_FONT_PATH = os.path.join(FONTS_DIR, "LiberationSans-Bold.ttf")
NOTO_SANS_PATH = os.path.join(FONTS_DIR, "NotoSans-Bold.ttf")
ANTON_FONT_PATH = os.path.join(FONTS_DIR, "Anton-Regular.ttf")
MONTSERRAT_FONT_PATH = os.path.join(FONTS_DIR, "Montserrat-Black.ttf")
DEJAVU_FONT_PATH = os.path.join(FONTS_DIR, "DejaVuSans-Bold.ttf")
_emoji_candidates = [
    os.path.join(FONTS_DIR, "NotoColorEmoji.ttf"),
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    "/System/Library/Fonts/Apple Color Emoji.ttc",
]
NOTO_EMOJI_PATH = next((p for p in _emoji_candidates if os.path.exists(p)), "")
SWOOSH_SOUND_PATH = os.path.join(REPO_ROOT, "frontend", "swoosh.mp3")
CORE_SOUND_PATH = os.path.join(REPO_ROOT, "frontend", "core.mp3")

_emoji_font = None
if NOTO_EMOJI_PATH and os.path.exists(NOTO_EMOJI_PATH):
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


def _get_font(size: int, preferred: str = "minimal") -> ImageFont.FreeTypeFont:
    if preferred == "anton":
        candidates = [ANTON_FONT_PATH, INTER_FONT_PATH, DEJAVU_FONT_PATH]
    elif preferred == "montserrat":
        candidates = [MONTSERRAT_FONT_PATH, INTER_FONT_PATH, LIBERATION_FONT_PATH, DEJAVU_FONT_PATH]
    else:  # "minimal" (default generic minimal font) or "inter"
        candidates = [INTER_FONT_PATH, LIBERATION_FONT_PATH, NOTO_SANS_PATH, MONTSERRAT_FONT_PATH, DEJAVU_FONT_PATH]

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
    shear: float = 0.0,
    align: str = "center",
    left_x: int = 90,
    stroke_width: int = 4,
    stroke_color: Tuple[int, int, int, int] = (0, 0, 0, 255),
    shadow_offset: Tuple[int, int] = (3, 5),
    shadow_color: Tuple[int, int, int, int] = (0, 0, 0, 190),
    spacing: int = 14,
) -> int:
    """Draw multi-colored text with outline, full-color emojis, and drop shadow."""
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

    # 3. Optional shear transform (italic slant if requested)
    if abs(shear) > 0.001:
        sheared = strip.transform(
            (sw, sh),
            Image.AFFINE,
            (1, shear, -shear * (sh / 2), 0, 1, 0),
            Image.BICUBIC,
        )
    else:
        sheared = strip

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
        clean = "RANKING VIRAL MOMENTS"

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
    countdown_order: bool = False,
    font_family: str = "minimal",
) -> Tuple[str, str]:
    """Generate 1080x1920 base and active overlay PNGs matching viral ranking reference."""
    base_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    active_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))

    is_anton = str(font_family).lower() == "anton"
    pref = "anton" if is_anton else "minimal"

    title_font = _get_font(74 if is_anton else 68, preferred=pref)
    rank_font = _get_font(62 if is_anton else 56, preferred=pref)
    watermark_font = _get_font(52 if is_anton else 46, preferred=pref)

    shear = 0.20 if is_anton else 0.0
    stroke_w = 7 if is_anton else 4
    shadow_off = (5, 8) if is_anton else (3, 5)
    shadow_col = (0, 0, 0, 220) if is_anton else (0, 0, 0, 180)

    dummy_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

    # -------------------------------------------------------------
    # 1. Top Title (Lines 1 and 2) -> Drawn onto base_img
    # -------------------------------------------------------------
    line1_chunks, line2_chunks = _parse_title_into_chunks(header_title)

    y_line1 = 78
    _draw_sheared_line(
        base_img,
        y=y_line1,
        chunks=line1_chunks,
        font=title_font,
        shear=shear,
        align="center",
        stroke_width=stroke_w,
        shadow_offset=shadow_off,
        shadow_color=shadow_col,
    )

    if line2_chunks:
        y_line2 = y_line1 + 92
        _draw_sheared_line(
            base_img,
            y=y_line2,
            chunks=line2_chunks,
            font=title_font,
            shear=shear,
            align="center",
            stroke_width=stroke_w,
            shadow_offset=shadow_off,
            shadow_color=shadow_col,
        )

    # -------------------------------------------------------------
    # 2. Ranking Numbers & Active / Past Item Titles
    # -------------------------------------------------------------
    max_items = min(len(all_clips), 5)
    start_y = 280 if line2_chunks else 210
    total_avail_height = 700 - start_y
    line_gap = max(70, min(86, total_avail_height // max(1, max_items)))

    # ALWAYS show ladder numbers linearly: 1, 2, 3, 4, 5 (top to bottom)
    # In countdown mode, clips are placed BOTTOM-UP on the ladder:
    #   Clip 0 (plays first) → row max_items-1 (rank 5)
    #   Clip 1 (plays second) → row max_items-2 (rank 4)
    #   etc.
    # In normal mode, clips map 1:1 to rows (clip 0 → row 0).
    for i in range(max_items):
        rank_val = i + 1
        rank_num_str = f"{rank_val}."
        color = RANK_PALETTE[(rank_val - 1) % len(RANK_PALETTE)]
        item_y = start_y + i * line_gap

        if countdown_order:
            clip_idx_for_row = max_items - 1 - i
            clip = all_clips[clip_idx_for_row] if clip_idx_for_row < len(all_clips) else {}
            is_current = (clip_idx_for_row == current_index)
            is_past = (clip_idx_for_row < current_index)
        else:
            clip = all_clips[i]
            is_current = (i == current_index)
            is_past = (i < current_index)

        # Measure rank number width for precise title horizontal alignment
        bb_num = dummy_draw.textbbox((0, 0), rank_num_str, font=rank_font, stroke_width=stroke_w)
        num_w = bb_num[2] - bb_num[0]
        title_x = 90 + num_w + 16

        raw_title = clip.get("rank_title") or clip.get("title") or f"Moment #{rank_val}"
        # Strip leading numbers like "1. ", "2 - " while preserving full emojis
        clean_title = re.sub(r'^\d+[\.\-\s]+', '', raw_title).strip()
        if len(clean_title) > 32:
            clean_title = clean_title[:30].rstrip() + "..."

        if is_past:
            chunks = [(rank_num_str, color), (clean_title, (255, 255, 255, 255))]
            _draw_sheared_line(
                base_img,
                y=item_y,
                chunks=chunks,
                font=rank_font,
                shear=shear,
                align="left",
                left_x=90,
                stroke_width=stroke_w,
                shadow_offset=shadow_off,
                shadow_color=shadow_col,
                spacing=16,
            )
        elif is_current:
            _draw_sheared_line(
                base_img,
                y=item_y,
                chunks=[(rank_num_str, color)],
                font=rank_font,
                shear=shear,
                align="left",
                left_x=90,
                stroke_width=stroke_w,
                shadow_offset=shadow_off,
                shadow_color=shadow_col,
                spacing=16,
            )
            _draw_sheared_line(
                active_img,
                y=item_y,
                chunks=[(clean_title, (255, 255, 255, 255))],
                font=rank_font,
                shear=shear,
                align="left",
                left_x=title_x,
                stroke_width=stroke_w,
                shadow_offset=shadow_off,
                shadow_color=shadow_col,
                spacing=16,
            )
        else:
            _draw_sheared_line(
                base_img,
                y=item_y,
                chunks=[(rank_num_str, color)],
                font=rank_font,
                shear=shear,
                align="left",
                left_x=90,
                stroke_width=stroke_w,
                shadow_offset=shadow_off,
                shadow_color=shadow_col,
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
            shear=shear,
            align="center",
            stroke_width=max(3, stroke_w - 2),
            stroke_color=(0, 0, 0, 180),
            shadow_offset=(2, 4),
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
    font_family: str = "minimal",
) -> Tuple[str, str]:
    """Generate 1080x1920 single title hook overlay PNG matching the viral spotlight reference image.

    Features:
    1. Prominent centered title hook at the top (white font, crisp stroke & shadow).
    2. Zero ranking numbers, zero ranking list.
    3. Channel watermark handle at the bottom if specified.
    """
    base_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    active_img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))

    is_anton = str(font_family).lower() == "anton"
    pref = "anton" if is_anton else "minimal"

    title_font = _get_font(76 if is_anton else 70, preferred=pref)
    watermark_font = _get_font(52 if is_anton else 46, preferred=pref)

    shear = 0.15 if is_anton else 0.0
    stroke_w = 9 if is_anton else 4
    shadow_off = (4, 7) if is_anton else (3, 5)
    shadow_col = (0, 0, 0, 230) if is_anton else (0, 0, 0, 180)

    clean = header_title.strip() if header_title else "VIRAL MOMENTS HIGHLIGHT"

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
            shear=shear,
            align="center",
            stroke_width=stroke_w,
            stroke_color=(0, 0, 0, 255),
            shadow_offset=shadow_off,
            shadow_color=shadow_col,
        )
        _draw_sheared_line(
            base_img,
            y=y2,
            chunks=[(line2, (255, 255, 255, 255))],
            font=title_font,
            shear=shear,
            align="center",
            stroke_width=stroke_w,
            stroke_color=(0, 0, 0, 255),
            shadow_offset=shadow_off,
            shadow_color=shadow_col,
        )
    else:
        _draw_sheared_line(
            base_img,
            y=135,
            chunks=[(line1, (255, 255, 255, 255))],
            font=title_font,
            shear=shear,
            align="center",
            stroke_width=stroke_w,
            stroke_color=(0, 0, 0, 255),
            shadow_offset=shadow_off,
            shadow_color=shadow_col,
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
            shear=shear,
            align="center",
            stroke_width=max(3, stroke_w - 2),
            stroke_color=(0, 0, 0, 180),
            shadow_offset=(2, 4),
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


def _to_ass_color(color_str: Optional[str], default: str = "&H0000FFFF") -> str:
    """Normalize color strings to 8-hex &HAABBGGRR format."""
    if not color_str:
        return default
    c = str(color_str).strip().rstrip("&")
    if not c.startswith("&H") and not c.startswith("&h"):
        if c.startswith("#"):
            hex_c = c.lstrip("#")
            if len(hex_c) == 6:
                r, g, b = hex_c[0:2], hex_c[2:4], hex_c[4:6]
                return f"&H00{b}{g}{r}".upper()
        c = f"&H{c}"
    hex_part = c[2:]
    if len(hex_part) == 6:
        return f"&H00{hex_part}".upper()
    elif len(hex_part) == 8:
        return f"&H{hex_part}".upper()
    return default


def generate_karaoke_ass(
    transcript: Dict[str, Any],
    clip_start: float,
    clip_end: float,
    out_ass_path: str,
    layout_mode: str = "1:1",
    caption_settings: Optional[Dict[str, Any]] = None,
    font_family: str = "minimal",
) -> str:
    """Generate ASS subtitle file with compact 1-2 line max styling and word-level karaoke."""
    if layout_mode == "1:1":
        margin_v = 220
    elif layout_mode == "16:9":
        margin_v = 670
    else:
        margin_v = 280

    raw_font = None
    raw_size = None
    user_color = None
    animation = "karaoke"
    if caption_settings:
        raw_font = caption_settings.get("font") or caption_settings.get("caption_font") or caption_settings.get("font_family")
        raw_size = caption_settings.get("size") or caption_settings.get("caption_size") or caption_settings.get("font_size")
        user_color = caption_settings.get("primary_color")
        if "animation" in caption_settings:
            animation = str(caption_settings["animation"]).lower()

    if animation == "none":
        return ""

    chosen_font = str(raw_font or "dejavu").lower()
    if "anton" in chosen_font or "meme" in chosen_font or "impact" in chosen_font:
        font_name = "Anton"
        default_size = 64
        default_outline = 6
    elif "montserrat" in chosen_font:
        font_name = "Montserrat Black"
        default_size = 58
        default_outline = 5
    elif "inter" in chosen_font:
        font_name = "Inter"
        default_size = 54
        default_outline = 5
    elif "liberation" in chosen_font:
        font_name = "Liberation Sans"
        default_size = 54
        default_outline = 5
    else:  # dejavu / v1 / classic
        font_name = "DejaVu Sans"
        default_size = 54
        default_outline = 5

    if isinstance(raw_size, (int, float)):
        font_size = int(raw_size)
    elif isinstance(raw_size, str):
        s_clean = raw_size.strip().lower()
        if s_clean in ("v1", "classic", "standard", "54"):
            font_size = 54
        elif s_clean in ("medium", "60"):
            font_size = 60
        elif s_clean in ("large", "big", "70", "84"):
            font_size = 70
        elif s_clean in ("xlarge", "huge", "80", "96"):
            font_size = 80
        elif s_clean in ("small", "compact", "46"):
            font_size = 46
        elif s_clean.isdigit():
            font_size = int(s_clean)
        else:
            font_size = default_size
    else:
        font_size = default_size

    outline_size = 5 if font_size <= 60 else max(5, int(round(font_size * 0.085)))

    # V1 exact style: Primary is white base, Secondary is yellow karaoke highlight
    base_color = "&H00FFFFFF"  # Unspoken base text (White)
    highlight_color = _to_ass_color(user_color, default="&H0000FFFF")  # Spoken word highlight (Yellow)
    outline_color = "&H00000000"    # Crisp black outline
    shadow_color = "&H90000000"     # Soft translucent drop shadow

    ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,{font_name},{font_size},{base_color},{highlight_color},{outline_color},{shadow_color},-1,0,0,0,100,100,0,0,1,{outline_size},2,2,60,60,{margin_v},1
Style: Default,{font_name},{font_size},{base_color},{highlight_color},{outline_color},{shadow_color},-1,0,0,0,100,100,0,0,1,{outline_size},2,2,60,60,{margin_v},1

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

        raw_words = seg.get("words", [])
        # Only take words falling within clip boundaries
        words = [
            w for w in raw_words
            if float(w.get("end", 0)) > clip_start and float(w.get("start", 0)) < clip_end and w.get("word", "").strip()
        ] if raw_words else []

        if words and animation != "clean":
            # Group word-level tokens into small punchy chunks (max 4-5 words or 30 chars, exactly like V1)
            chunks = []
            curr_chunk = []
            curr_len = 0
            for w in words:
                w_text = w.get("word", "").strip()
                if not w_text:
                    continue
                if curr_chunk and (len(curr_chunk) >= 5 or curr_len + len(w_text) + 1 > 30):
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
                rel_start = max(0.0, c_start - clip_start)
                rel_end = min(clip_dur, c_end - clip_start)
                if rel_end <= rel_start:
                    continue

                t_start = format_ass_time(rel_start)
                t_end = format_ass_time(rel_end)

                karaoke_tokens = []
                for w in chunk:
                    w_start = max(clip_start, float(w["start"]))
                    w_end = min(clip_end, float(w["end"]))
                    w_dur_cs = max(8, int(round((w_end - w_start) * 100)))
                    word_clean = w["word"].strip().upper()
                    karaoke_tokens.append(f"{{\\k{w_dur_cs}}}{word_clean} ")

                line_text = "".join(karaoke_tokens).strip()
                dialogues.append(f"Dialogue: 0,{t_start},{t_end},Karaoke,,0,0,0,,{line_text}")
        else:
            # Segment-level text or clean/static text: split into small 3-4 word chunks and interpolate timing
            seg_text = seg.get("text", "").strip()
            if not seg_text:
                continue

            raw_words = seg_text.split()
            if not raw_words:
                continue

            # Chunk into max 4-5 words or max 30 characters to guarantee max 1-2 lines
            chunks = []
            curr_chunk = []
            curr_len = 0
            for rw in raw_words:
                if curr_chunk and (len(curr_chunk) >= 5 or curr_len + len(rw) + 1 > 30):
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

    if not dialogues:
        return ""

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
    transition_type: str = "swoosh",
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
    # Swoosh sound is only used in swoosh mode
    has_swoosh = bool(transition_type != "black_screen" and os.path.exists(SWOOSH_SOUND_PATH))
    has_source_audio = _check_has_audio(source_path)

    ass_filter = ""
    if ass_path and os.path.exists(ass_path):
        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")
        safe_fonts = os.path.abspath(FONTS_DIR).replace("\\", "/").replace(":", "\\:")
        ass_filter = f",ass='{safe_ass}':fontsdir='{safe_fonts}'"

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
        if transition_type == "black_screen":
            # Clean static clip with NO transitions (no fade in, no fade out, no sliding text/video)
            if layout_mode == "1:1":
                fg_comp = (
                    "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic,setsar=1[v_bg];"
                    "[0:v]crop=ih:ih:(iw-ih)/2:0,scale=1080:1080,setsar=1[v_fg];"
                    "[v_bg][v_fg]overlay=0:720[v_comp]"
                )
            elif layout_mode == "16:9":
                fg_comp = (
                    "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic,setsar=1[v_bg];"
                    "[0:v]scale=1080:608,setsar=1[v_fg];"
                    "[v_bg][v_fg]overlay=0:720[v_comp]"
                )
            else:
                fg_comp = (
                    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,setsar=1[v_comp]"
                )

            video_filter = (
                f"{fg_comp};"
                f"[v_comp][1:v]overlay=0:0[v_base];"
                f"[v_base][2:v]overlay=0:0{ass_filter},setsar=1[v_out]"
            )
        else:
            # Default: Subtle clip transition + text appear animation + swoosh sound
            if layout_mode == "1:1":
                fg_comp = (
                    "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic,setsar=1[v_bg];"
                    "[0:v]crop=ih:ih:(iw-ih)/2:0,scale=1080:1080,setsar=1,fade=t=in:st=0:d=0.18:color=white[v_fg];"
                    "[v_bg][v_fg]overlay=x='if(lt(t,0.25), 60*pow(1-t/0.25, 2), 0)':y=720[v_comp]"
                )
            elif layout_mode == "16:9":
                fg_comp = (
                    "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic,setsar=1[v_bg];"
                    "[0:v]scale=1080:608,setsar=1,fade=t=in:st=0:d=0.18:color=white[v_fg];"
                    "[v_bg][v_fg]overlay=x='if(lt(t,0.25), 60*pow(1-t/0.25, 2), 0)':y=720[v_comp]"
                )
            else:
                fg_comp = (
                    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,setsar=1,fade=t=in:st=0:d=0.18:color=white[v_comp]"
                )

            video_filter = (
                f"{fg_comp};"
                f"[v_comp][1:v]overlay=0:0[v_base];"
                f"[v_base][2:v]overlay=x='if(lt(t,0.35), -800*pow(1-t/0.35, 2), 0)':y=0{ass_filter},setsar=1[v_out]"
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
                "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic,setsar=1[v_bg];"
                "[0:v]crop=ih:ih:(iw-ih)/2:0,scale=1080:1080,setsar=1[v_fg];"
                f"[v_bg][v_fg]overlay=0:720[v_comp];"
                f"[v_comp][1:v]overlay=0:0{ass_filter},setsar=1[v_out]"
            )
        elif layout_mode == "16:9":
            filter_complex = (
                "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=1080:1920:flags=bicubic,setsar=1[v_bg];"
                "[0:v]scale=1080:608,setsar=1[v_fg];"
                f"[v_bg][v_fg]overlay=0:720[v_comp];"
                f"[v_comp][1:v]overlay=0:0{ass_filter},setsar=1[v_out]"
            )
        else:
            filter_complex = (
                "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,setsar=1[v_bg];"
                f"[v_bg][1:v]overlay=0:0{ass_filter},setsar=1[v_out]"
            )
        audio_map = ["0:a:0?"]

    # Write to a temp file first then rename — avoids the "+faststart re-open" failure
    # when a partially-written file from a previous failed render still exists on disk.
    tmp_path = out_path + ".tmp.mp4"
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "[v_out]",
        "-map", audio_map[0],
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-threads", "0",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        "-t", f"{duration:.3f}",
        "-movflags", "+faststart",
        tmp_path,
    ])
    subprocess.run(cmd, check=True)
    # Atomic rename: replaces any stale file from a previous run
    os.replace(tmp_path, out_path)
    return out_path


def _get_audio_duration(file_path: str) -> float:
    """Return exact audio duration in seconds using ffprobe."""
    if not os.path.exists(file_path):
        return 0.731
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path,
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        dur = float(res.stdout.strip())
        return max(0.1, dur)
    except Exception:
        return 0.731


def generate_black_transition_segment(
    out_path: str,
    overlay_png: str,
    active_overlay_png: Optional[str] = None,
    duration: Optional[float] = None,
) -> str:
    """Generate a 1080x1920 black transition segment (clip + blur blacked out) keeping Layer 1, 2, 3 overlays visible, matching exact core.mp3 duration."""
    has_core = bool(os.path.exists(CORE_SOUND_PATH))
    has_active = bool(active_overlay_png and os.path.exists(active_overlay_png))

    if duration is None:
        duration = _get_audio_duration(CORE_SOUND_PATH) if has_core else 0.731

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", f"color=c=black:s=1080x1920:r=30:d={duration:.3f}",
        "-loop", "1", "-i", overlay_png,
    ]
    if has_active:
        cmd.extend(["-loop", "1", "-i", active_overlay_png])

    if has_core:
        cmd.extend(["-i", CORE_SOUND_PATH])
        audio_idx = 3 if has_active else 2
        audio_filter = f";[{audio_idx}:a]apad=pad_dur={duration:.3f},atrim=0:{duration:.3f},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a_out]"
        audio_map = ["[a_out]"]
    else:
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"])
        audio_idx = 3 if has_active else 2
        audio_filter = ""
        audio_map = [f"{audio_idx}:a"]

    if has_active:
        video_filter = (
            "[0:v][1:v]overlay=0:0[v_base];"
            f"[v_base][2:v]overlay=0:0,setsar=1[v_out]{audio_filter}"
        )
    else:
        video_filter = (
            f"[0:v][1:v]overlay=0:0,setsar=1[v_out]{audio_filter}"
        )

    tmp_path = out_path + ".tmp.mp4"
    cmd.extend([
        "-filter_complex", video_filter,
        "-map", "[v_out]",
        "-map", audio_map[0],
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-threads", "0",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        "-t", f"{duration:.3f}",
        "-movflags", "+faststart",
        tmp_path,
    ])
    subprocess.run(cmd, check=True)
    os.replace(tmp_path, out_path)
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
    caption_settings: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Any] = None,
    template_type: str = "ranking",
    countdown_order: bool = False,
    transition_type: str = "swoosh",
    font_family: str = "minimal",
) -> str:
    """Full pipeline: composites multiple clips into final_short.mp4 supporting ranking and single_title templates."""
    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(os.path.dirname(final_output_path), exist_ok=True)

    # Clean stale segment/overlay/transition files from previous renders
    import glob
    for stale in glob.glob(os.path.join(work_dir, "seg_*.mp4")) + glob.glob(os.path.join(work_dir, "trans_*.mp4")):
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
                font_family=font_family,
            )
        else:
            base_png, active_png = generate_rank_overlay_png(
                header_title=header_title,
                all_clips=selected_clips,
                current_index=idx,
                out_path=overlay_png,
                layout_mode=layout_mode,
                channel_handle=channel_handle,
                countdown_order=countdown_order,
                font_family=font_family,
            )

        if idx > 0 and transition_type == "black_screen":
            # Between clips: straight up black clip (clip + blur black, keeping layers 1,2,3) matching exact core.mp3 duration
            trans_out = os.path.join(work_dir, f"trans_black_{idx:02d}.mp4")
            generate_black_transition_segment(
                out_path=trans_out,
                overlay_png=base_png,
                active_overlay_png=active_png,
            )
            segment_paths.append(trans_out)

        clip_source = clip.get("source_video_path") or clip.get("source_path") or source_video_path
        # Ensure absolute path for reliable FFmpeg input
        if clip_source and not os.path.isabs(clip_source):
            clip_source = os.path.abspath(clip_source)
        clip_transcript = clip.get("transcript") or transcript

        # 2. Generate ASS subtitles only if captions are enabled
        if captions_enabled and clip_transcript:
            ass_candidate = os.path.join(work_dir, f"subtitles_{idx + 1:02d}.ass")
            res_ass = generate_karaoke_ass(
                transcript=clip_transcript,
                clip_start=float(clip["start_time"]),
                clip_end=float(clip["end_time"]),
                out_ass_path=ass_candidate,
                layout_mode=layout_mode,
                caption_settings=caption_settings,
                font_family=font_family,
            )
            if res_ass and os.path.exists(res_ass) and os.path.getsize(res_ass) > 0:
                ass_path = res_ass

        # 3. Render segment with FFmpeg
        render_single_segment(
            source_path=clip_source,
            clip_info=clip,
            overlay_png=base_png,
            active_overlay_png=active_png,
            ass_path=ass_path,
            out_path=seg_out,
            layout_mode=layout_mode,
            transition_type=transition_type,
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


# ==============================================================================
# V2 Modular Template Architecture & Render Cache
# ==============================================================================

import hashlib
import json


def compute_render_hash(
    production_id: str,
    clips: List[Dict[str, Any]],
    template: str,
    aspect_ratio: str = "9:16",
    layout_mode: str = "1:1",
    caption_settings: Optional[Dict[str, Any]] = None,
    header_title: Optional[str] = None,
    transition_type: str = "swoosh",
    font_family: str = "minimal",
    countdown_order: bool = False,
    channel_handle: Optional[str] = None,
) -> str:
    """Generate a deterministic SHA-256 hash for a production render configuration."""
    clip_signatures = []
    for c in clips:
        clip_signatures.append({
            "id": str(c.get("id") or c.get("clip_id") or ""),
            "title": str(c.get("custom_title") or c.get("rank_title") or c.get("title") or ""),
            "start": round(float(c.get("start_override") if c.get("start_override") is not None else c.get("start_time", 0.0)), 2),
            "end": round(float(c.get("end_override") if c.get("end_override") is not None else c.get("end_time", 0.0)), 2),
        })

    payload = {
        "production_id": production_id,
        "clips": clip_signatures,
        "template": template or "ranking",
        "aspect_ratio": aspect_ratio or "9:16",
        "layout_mode": layout_mode or "1:1",
        "header_title": header_title or "",
        "caption_settings": caption_settings or {},
        "transition_type": transition_type or "swoosh",
        "font_family": font_family or "minimal",
        "countdown_order": bool(countdown_order),
        "channel_handle": channel_handle.strip() if channel_handle else "",
    }
    raw = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


class BaseTemplateRenderer:
    """Abstract base renderer for production templates."""
    def render(
        self,
        production_id: str,
        header_title: str,
        selected_clips: List[Dict[str, Any]],
        work_dir: str,
        final_output_path: str,
        layout_mode: str = "1:1",
        channel_handle: Optional[str] = None,
        captions_enabled: bool = True,
        caption_settings: Optional[Dict[str, Any]] = None,
        transition_type: str = "swoosh",
        font_family: str = "minimal",
        countdown_order: bool = False,
        progress_callback: Optional[Any] = None,
        is_preview: bool = False,
    ) -> str:
        raise NotImplementedError


class RankingTemplateRenderer(BaseTemplateRenderer):
    """Viral ranking list template with animated headers, countdown/sequential ranks, and reveals."""
    def render(
        self,
        production_id: str,
        header_title: str,
        selected_clips: List[Dict[str, Any]],
        work_dir: str,
        final_output_path: str,
        layout_mode: str = "1:1",
        channel_handle: Optional[str] = None,
        captions_enabled: bool = True,
        caption_settings: Optional[Dict[str, Any]] = None,
        transition_type: str = "swoosh",
        font_family: str = "minimal",
        countdown_order: bool = False,
        progress_callback: Optional[Any] = None,
        is_preview: bool = False,
    ) -> str:
        return render_ranking_short(
            source_video_path="",
            transcript={},
            header_title=header_title,
            selected_clips=selected_clips,
            work_dir=work_dir,
            final_output_path=final_output_path,
            layout_mode=layout_mode,
            channel_handle=channel_handle,
            captions_enabled=captions_enabled,
            caption_settings=caption_settings,
            progress_callback=progress_callback,
            template_type="ranking",
            countdown_order=countdown_order,
            transition_type=transition_type,
            font_family=font_family,
        )


class SingleTitleTemplateRenderer(BaseTemplateRenderer):
    """Clean single hook title template with karaoke captions and framed focus."""
    def render(
        self,
        production_id: str,
        header_title: str,
        selected_clips: List[Dict[str, Any]],
        work_dir: str,
        final_output_path: str,
        layout_mode: str = "1:1",
        channel_handle: Optional[str] = None,
        captions_enabled: bool = True,
        caption_settings: Optional[Dict[str, Any]] = None,
        transition_type: str = "swoosh",
        font_family: str = "minimal",
        countdown_order: bool = False,
        progress_callback: Optional[Any] = None,
        is_preview: bool = False,
    ) -> str:
        return render_ranking_short(
            source_video_path="",
            transcript={},
            header_title=header_title,
            selected_clips=selected_clips,
            work_dir=work_dir,
            final_output_path=final_output_path,
            layout_mode=layout_mode,
            channel_handle=channel_handle,
            captions_enabled=captions_enabled,
            caption_settings=caption_settings,
            progress_callback=progress_callback,
            template_type="single_title",
            countdown_order=False,
            transition_type=transition_type,
            font_family=font_family,
        )


TEMPLATE_REGISTRY: Dict[str, BaseTemplateRenderer] = {
    "ranking": RankingTemplateRenderer(),
    "single_title": SingleTitleTemplateRenderer(),
}


def render_production(
    production_id: str,
    header_title: str,
    clips: List[Dict[str, Any]],
    template: str = "ranking",
    aspect_ratio: str = "9:16",
    layout_mode: str = "1:1",
    caption_settings: Optional[Dict[str, Any]] = None,
    channel_handle: Optional[str] = None,
    transition_type: str = "swoosh",
    font_family: str = "minimal",
    countdown_order: bool = False,
    is_preview: bool = False,
    progress_callback: Optional[Any] = None,
    output_dir: str = "output",
) -> Tuple[str, str, bool]:
    """Render a Short from a Production definition with deterministic caching.
    
    Returns:
        (final_output_path, render_hash, is_cache_hit)
    """
    captions_enabled = True
    if caption_settings and "captions_enabled" in caption_settings:
        captions_enabled = bool(caption_settings["captions_enabled"])

    render_hash = compute_render_hash(
        production_id=production_id,
        clips=clips,
        template=template,
        aspect_ratio=aspect_ratio,
        layout_mode=layout_mode,
        caption_settings=caption_settings,
        header_title=header_title,
        transition_type=transition_type,
        font_family=font_family,
        countdown_order=countdown_order,
        channel_handle=channel_handle,
    )

    renders_dir = os.path.join(output_dir, "renders", production_id)
    os.makedirs(renders_dir, exist_ok=True)
    final_output_path = os.path.join(renders_dir, f"{render_hash}.mp4")

    # Check Render Cache
    if os.path.exists(final_output_path) and os.path.getsize(final_output_path) > 10000:
        print(f"[render_engine] Cache HIT for production {production_id} ({render_hash}): reusing {final_output_path}", flush=True)
        return final_output_path, render_hash, True

    work_dir = os.path.join(renders_dir, f"work_{render_hash}")
    os.makedirs(work_dir, exist_ok=True)

    renderer = TEMPLATE_REGISTRY.get(template.lower(), TEMPLATE_REGISTRY["ranking"])
    out = renderer.render(
        production_id=production_id,
        header_title=header_title,
        selected_clips=clips,
        work_dir=work_dir,
        final_output_path=final_output_path,
        layout_mode=layout_mode,
        channel_handle=channel_handle,
        captions_enabled=captions_enabled,
        caption_settings=caption_settings,
        transition_type=transition_type,
        font_family=font_family,
        countdown_order=countdown_order,
        progress_callback=progress_callback,
        is_preview=is_preview,
    )
    return out, render_hash, False

