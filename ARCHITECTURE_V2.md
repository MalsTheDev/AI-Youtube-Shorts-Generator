# AI YouTube Shorts Studio V2: Architecture & Migration Specification

## 1. Executive Summary & System Overview

AI YouTube Shorts Studio V2 transforms the legacy processing script and batch queue into a professional, creator-centric Short Production Studio. The core philosophy separates media discovery, asset curation, production composition, and video rendering into decoupled stages.

### Core Mental Model
```text
SOURCE ("What did the user provide?")
  │  (Download & Transcribe once)
  ▼
AI DISCOVERY ("What viral moments were discovered?")
  │  (Score, Chunk, Deduplicate)
  ▼
CLIP ASSET REPOSITORY (/clips) ("Curate, favorite, tag, search")
  │
  ├── Multi-Clip Lightweight Editor (/clips/edit - Trim & Title metadata only)
  │
  ▼
PRODUCTION STUDIO (/productions/[id]) ("Compose clips, choose template & captions, craft metadata")
  │
  ▼
RENDER ENGINE (On-demand rendering with deterministic caching)
  │
  ▼
RENDER LIBRARY (/renders) ("Preview, download, inspect final outputs")
```

---

## 2. Audit of Existing Architecture (V1)

### 2.1 Backend (`server.py`, `shorts_generator/`)
- **Ingestion Coupling**: When a YouTube URL is queued via `/api/jobs/batch`, Celery executes `process_video_task`. In `pipeline.py` / `server.py`, the ingestion automatically crops all candidates and renders an initial `final_short.mp4` ranking video. This creates severe CPU/GPU bottlenecks and disk waste.
- **Data Model Overload**: `ClipCandidate` was tightly bound to `videos` and conflated candidate discovery with production instances. If a clip was trimmed in `/review/[jobId]`, the base candidate was mutated or re-rendered.
- **Review Page Overload**: `/review/[jobId]` combined source logs, candidate selection, live cropping, re-rendering, and publishing into a single fragile page.
- **Concurrency & Queues**: Single Celery worker concurrency=3 running on a single task name `process_video_task`. Renders triggered from FastAPI routes used ad-hoc `BackgroundTasks`.

### 2.2 Database & Storage (`database.py`, MySQL on port 3307)
- **Current Tables & Row Counts (Verified)**:
  - `videos`: 42 records (YouTube sources and uploaded mp4s)
  - `clip_candidates`: 201 records (extracted moments with virality scores, emojis, titles)
  - `rendered_shorts`: 60 records (finished compilation videos)
  - `youtube_channels`: 2 records
- **Storage Layout**:
  - `output/source_{yt_id}.mp4`
  - `output/source_{yt_id}.transcript.json` and `.srt`
  - `output/source_{yt_id}.highlights.json`
  - `output/job_{id}/final_short.mp4`

### 2.3 Frontend (`frontend/src/`)
- Existing navigation: `/queue`, `/clips`, `/review`, `/publishing`.
- `/clips/page.tsx` grouped clips strictly by video, lacked multi-select workspace editing, and lacked proper production creation.
- Root `/` simply redirected to `/queue`.

---

## 3. Non-Negotiable Architectural Rules & Solutions

| Rule | V1 Flaw | V2 Solution |
| :--- | :--- | :--- |
| **1. Clips are reusable assets, NOT final videos** | Clips were coupled to a single video/job | New `Clip` entity and many-to-many `ProductionClip` join entity. Single clip can be in multiple productions with distinct order and trim overrides. |
| **2. Clip editing must NOT perform expensive rendering** | Trimming often triggered or assumed clip MP4 rendering | Trimming updates `start_time` and `end_time` in database in <5ms. Video player uses native source video timestamp offsets (`currentTime`). Zero FFmpeg rendering during clip editing. |
| **3. Processing a source NEVER automatically creates a final Short** | `pipeline.py` and `server.py` ran `render_ranking_short` on every job | Pipeline terminates immediately after `create_clip_records`. Zero automatic rendering during source ingestion. |
| **4. `/clips` is the center of the application** | `/queue` was default landing page | `/clips` becomes high-performance media asset manager with search, filter (All, New, Favorites, Edited, Used, Unused, Archived), multi-select, and direct "Edit Selected" or "Create Short". |
| **5. Old `/review/[jobId]` is NOT editing workflow** | Overloaded job page | Split into `/sources/[sourceId]` (source diagnostics, transcript, logs, discovered clips) and `/productions/[id]` (creative studio). `/review/[id]` safely redirects. |
| **6. Rendering is a Production operation** | Renders tied to jobs or arbitrary clip lists | Rendering is strictly invoked on a `Production` entity. Produces deterministic cached `Render` record. |
| **7. Modular rendering templates** | Templates coupled inside large functions | Independent template interface (`RankingTemplate`, `SingleTitleTemplate`) extensible for future layouts. |
| **8. No hard-coded 60s Shorts limit** | Hard-coded 60s assumptions | Configurable `max_duration` in Production with sensible defaults (60s / 180s) and validation. |
| **9. Existing data must survive** | Risk of schema loss | Zero `DROP TABLE` or `RESET`. Incremental schema migration populating `Clip`, `Production`, `Render` from existing records. |

---

## 4. V2 Database Schema Design & Migration Plan

### 4.1 Schema Definition

```sql
-- Sources (Extends existing 'videos' table with pipeline tracking)
ALTER TABLE videos 
  ADD COLUMN IF NOT EXISTS youtube_video_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS current_stage VARCHAR(32) DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS progress VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS started_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(512) NULL;

-- Reusable Clip Model
CREATE TABLE IF NOT EXISTS clips (
  id VARCHAR(64) PRIMARY KEY,
  source_id VARCHAR(36) NOT NULL,
  start_time FLOAT NOT NULL,
  end_time FLOAT NOT NULL,
  title VARCHAR(255) NOT NULL,
  original_title VARCHAR(255) NOT NULL,
  ai_score INT NOT NULL DEFAULT 85,
  ai_reason TEXT NULL,
  hook_sentence TEXT NULL,
  emoji VARCHAR(32) DEFAULT '🔥',
  category VARCHAR(128) DEFAULT 'General',
  character_name VARCHAR(128) NULL,
  tags JSON NULL,
  is_favorite BOOLEAN DEFAULT FALSE,
  is_edited BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  deleted_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_source (source_id),
  INDEX idx_favorite (is_favorite),
  INDEX idx_score (ai_score),
  FOREIGN KEY (source_id) REFERENCES videos(id) ON DELETE CASCADE
);

-- Transcripts & Word-Level Segments
CREATE TABLE IF NOT EXISTS transcripts (
  id VARCHAR(64) PRIMARY KEY,
  source_id VARCHAR(36) NOT NULL,
  language VARCHAR(16) DEFAULT 'en',
  model VARCHAR(64) DEFAULT 'whisper-base',
  version VARCHAR(32) DEFAULT '1.0',
  duration FLOAT NOT NULL DEFAULT 0.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id VARCHAR(64) PRIMARY KEY,
  transcript_id VARCHAR(64) NOT NULL,
  start_time FLOAT NOT NULL,
  end_time FLOAT NOT NULL,
  text TEXT NOT NULL,
  words_json JSON NULL,
  INDEX idx_transcript_time (transcript_id, start_time),
  FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Production Composition Model
CREATE TABLE IF NOT EXISTS productions (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  template VARCHAR(64) NOT NULL DEFAULT 'ranking',
  aspect_ratio VARCHAR(32) NOT NULL DEFAULT '9:16',
  layout_mode VARCHAR(32) NOT NULL DEFAULT '1:1',
  title VARCHAR(255) NULL,
  description TEXT NULL,
  tags JSON NULL,
  hashtags JSON NULL,
  caption_settings JSON NULL,
  max_duration FLOAT NOT NULL DEFAULT 60.0,
  transition_type VARCHAR(64) DEFAULT 'swoosh',
  channel_handle VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  render_progress VARCHAR(255) NULL,
  render_error TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Many-to-Many Production Clips with Overrides
CREATE TABLE IF NOT EXISTS production_clips (
  id VARCHAR(64) PRIMARY KEY,
  production_id VARCHAR(64) NOT NULL,
  clip_id VARCHAR(64) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  custom_title VARCHAR(255) NULL,
  start_override FLOAT NULL,
  end_override FLOAT NULL,
  INDEX idx_prod_pos (production_id, position),
  FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

-- Final Renders Output Library
CREATE TABLE IF NOT EXISTS renders (
  id VARCHAR(64) PRIMARY KEY,
  production_id VARCHAR(64) NULL,
  render_hash VARCHAR(64) NOT NULL,
  header_title VARCHAR(255) NOT NULL,
  output_file_path VARCHAR(1024) NOT NULL,
  file_size_bytes BIGINT NULL,
  duration FLOAT NULL,
  template VARCHAR(64) NOT NULL DEFAULT 'ranking',
  aspect_ratio VARCHAR(32) NOT NULL DEFAULT '9:16',
  is_preview BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_render_hash (render_hash)
);
```

### 4.2 Safe Data Migration Execution
1. Run non-destructive column additions on `videos`.
2. Create new tables (`clips`, `transcripts`, `transcript_segments`, `productions`, `production_clips`, `renders`).
3. Migrate all 201 rows from `clip_candidates` into `clips`:
   - `id` = `clip_candidates.id`
   - `source_id` = `clip_candidates.video_id`
   - `start_time` = `clip_candidates.start_time`
   - `end_time` = `clip_candidates.end_time`
   - `title` = `clip_candidates.rank_title`
   - `original_title` = `clip_candidates.rank_title`
   - `ai_score` = `clip_candidates.virality_score`
   - `emoji` = `clip_candidates.emoji`
   - `category` = `clip_candidates.category`
   - `character_name` = `clip_candidates.character_name`
   - `tags` = parsed tags
4. Migrate all 60 rows from `rendered_shorts` into `renders`:
   - `id` = `rendered_shorts.id`
   - `header_title` = `rendered_shorts.header_title`
   - `output_file_path` = `rendered_shorts.output_file_path`
   - Calculate `file_size_bytes` and duration from existing files where present.
5. Ingest existing JSON transcripts into `transcripts` and `transcript_segments` so full-text search and word-level timing are immediately available.

---

## 5. Ingestion Pipeline & Performance Decoupling

### Pipeline Stages
```text
Stage 1: download_source
  • Checks youtube_video_id cache. If output/source_{id}.mp4 exists, reuses immediately.
  • Updates source: status='downloading' -> status='downloaded'

Stage 2: transcribe_source
  • Checks output/source_{id}.transcript.json. If exists, loads cache.
  • Otherwise runs faster-whisper with word-level timestamps.
  • Populates `transcripts` and `transcript_segments`.
  • Updates source: status='transcribing' -> status='transcribed'

Stage 3: analyze_highlights
  • Semantic chunking if >30 min.
  • LLM structured prompt with Pydantic output validation.
  • Overlap suppression & deduplication.
  • Updates source: status='analyzing'

Stage 4: create_clip_records
  • Inserts new rows into `clips` (idempotent, avoids duplicate timestamps).
  • Updates source: status='completed', clips_discovered=N.
  • PIPELINE ENDS HERE. ZERO RENDERING.
```

---

## 6. Render Engine Architecture V2

### 6.1 Modular Templates
```text
BaseTemplateRenderer (Abstract)
  ├── RankingTemplateRenderer:
  │     • Top multi-colored italic Anton/Inter header with drop shadow
  │     • Sequential ranking numbers (1. to N. or countdown N. to 1.)
  │     • Active clip highlight reveal
  │     • Swoosh or black screen transition between clips
  │     • Centered karaoke ASS subtitles
  │
  └── SingleTitleTemplateRenderer:
        • Hook title overlay with clean typography
        • 1:1 square or 16:9 widescreen video foreground with blurred background
        • Centered karaoke ASS subtitles
```

### 6.2 Deterministic Render Caching
Compute MD5/SHA256 hash of:
```python
cache_key = f"{production.id}_{sorted_clip_ids}_{clip_trims}_{production.template}_{production.aspect_ratio}_{caption_settings_hash}"
render_hash = hashlib.sha256(cache_key.encode()).hexdigest()[:16]
```
If `output/renders/{production_id}/{render_hash}.mp4` exists in `renders` table with status 'completed', return immediately without invoking FFmpeg.

### 6.3 Separation of Preview vs Final Render
- **Clip Editor**: Uses HTML5 video element seeking (`<video src="/output/source.mp4#t=start,end">`). Instant playback with 0 rendering cost.
- **Production Preview**: Fast 540x960 low-crf preview or first 5 seconds per clip when requested.
- **Final Render**: Full 1080x1920 60fps high-bitrate composition.

---

## 7. Frontend UI / UX Architecture

### Navigation Layout
```text
Sidebar:
  [AI Shorts Studio]
  ├── Overview (Dashboard /)
  ├── Sources (/sources)
  ├── Clips (/clips) ⭐ [Primary Hub]
  ├── Productions (/productions)
  ├── Renders (/renders)
  └── Settings (/settings)
  [+ Add Videos] (Global Action Modal)
```

### Page Breakdown
1. **`/` (Dashboard)**: High level studio activity: Add Videos CTA, active processing queue, Clip repository quick stats (count, favorites, edited), and recent productions.
2. **`/sources`**: Source table/cards, batch URL submission, live stage indicators (downloading -> transcribing -> analyzing -> clips created), retry/cancel.
3. **`/sources/[id]`**: Source inspection replacing old review page. Metadata, processing timeline, logs, interactive transcript viewer, discovered clips list with "Open in Clips".
4. **`/clips`**: Central asset repository. Fast search (title, tags, category, character), filter pills (All, New, Favorites, Edited, Used, Unused, Archived), sort by AI score / date / duration. Multi-selection toolbar: "Edit Selected", "Create Short", "Favorite", "Archive".
5. **`/clips/edit`**: Multi-clip lightweight editor. Tabbed clip switcher (`[1] [2] [3]...`), 9:16 preview player, dual slider trimming, title edit, transcript segment jump-to-time, favorite/archive toggles. Saves to DB without video rendering.
6. **`/productions`**: Production library listing all compositions, templates, clip counts, status, and actions.
7. **`/productions/new` & `/productions/[id]`**: Production composition studio. Interactive clip sequencing, clip-specific trim overrides, template selection (Ranking vs Single Title), caption styling (colors, font, position), YouTube metadata assistant (AI Title/Description/Tags suggestions with Accept/Reject), and "Render Short" CTA.
8. **`/renders`**: Finished outputs grid. Video player modal, download file, link back to production, metadata copy.
9. **`/review/[jobId]`**: Backward-compatible route with automatic permanent redirect to `/sources/[jobId]`.

---

## 8. Backwards Compatibility & Verification Plan

- **Old APIs**: Maintain `/api/jobs`, `/api/jobs/{id}`, `/api/videos`, `/api/shorts` endpoints as proxies/adapters to the new V2 data model so any existing automation or bookmarks continue functioning.
- **Old Data**: All 42 videos, 201 clips, and 60 renders are safely preserved and queryable.
- **Verification**:
  - Run database migration script and assert row counts match or exceed existing data.
  - Test source processing pipeline: verify no automatic mp4 renders are created.
  - Test clip trim: verify DB timestamps update with zero FFmpeg process spawned.
  - Test production creation and rendering: verify final MP4 produced and cached correctly.
  - Test frontend navigation and all routes in browser.
