# 🎬 AI YouTube Shorts Studio V2

> A professional, decoupled studio for automated & curated YouTube Shorts creation. Ingest long-form videos, discover viral highlights with AI, curate a reusable clips asset library, compose multi-clip productions with non-destructive editing, and render deterministic shorts with animated countdown overlays and karaoke captions.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Next.js](https://img.shields.io/badge/Next.js-14%2F15-black)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)
![MySQL](https://img.shields.io/badge/MySQL-8.0-orange)
![Redis](https://img.shields.io/badge/Redis-Queue-red)

---

## ⚡ What Makes V2 Different?

Unlike older pipelines that immediately rendered a fixed video upon URL entry, **Shorts Studio V2** is architected as a professional creator studio:

```text
Source Video (YouTube / Local MP4)
       │
       ▼ (Decoupled Pipeline: Download ➔ Whisper ➔ Gemini Analysis)
  Clips Asset Library (Reusable Clips #1, #2, #3...)
       │
       ├──► Production A (e.g. "Top 3 Moments") ──► Deterministic Render (SHA-256 Cached)
       └──► Production B (e.g. "Single Highlight") ──► YouTube Direct Publisher
```

1. **Clips are Reusable Assets, Not Final Videos**:
   Discovered clips are independent assets stored in the database. A single clip can be reused across unlimited productions without duplicating the underlying video file on disk.
2. **Decoupled Pipeline (Zero Auto-Rendering)**:
   Ingesting a video transcribes and extracts candidate highlights into your library—**no unprompted, expensive video rendering occurs**. Rendering is strictly on-demand.
3. **Zero-FFmpeg Non-Destructive Editing**:
   Trim start/end points, rename hooks, choose emojis, and tag favorites instantly. Adjustments update database metadata in real-time with zero FFmpeg latency.
4. **Deterministic SHA-256 Render Caching**:
   Render compositions are hashed over template type, clip boundaries, captions, and layout. Re-rendering identical compositions hits the cache in **~0.01s** with zero redundant CPU/GPU load.
5. **Universal Video Ingestion**:
   Paste YouTube URLs or upload local MP4 episodes with 3 distinct options: **Single Clip**, **Manual Timestamp Cuts** (`HH:MM:SS`), or **AI Highlight Discovery**.
6. **Ultra-Lightweight On-Demand Thumbnails**:
   Instant single-frame extraction (~0.03s) cached permanently to disk as lightweight JPEGs.
7. **Clean Minimal Dark UI**:
   Built with Next.js, Tailwind CSS, and Lucide icons using a modern Zinc monochrome aesthetic.

---

## 🗂️ Studio Navigation & Architecture

| Route | View | Description |
|---|---|---|
| `/` | **Studio Dashboard** | System overview, pipeline status, storage stats, and quick workflows. |
| `/sources` | **Source Videos** | Ingest YouTube URLs or upload local MP4s; monitor transcription & analysis progress; view transcripts. |
| `/sources/[id]` | **Source Inspector** | Full source playback with interactive, click-to-seek transcript viewer. |
| `/clips` | **Clips Asset Library** | Primary hub: search, filter (Favorites, New, Edited, Used), bulk actions, 9:16 preview modal. |
| `/clips/edit` | **Non-Destructive Editor** | Multi-clip switcher, dual-handle trim slider, title & emoji controls, instant save without render. |
| `/productions` | **Productions Hub** | Manage draft and rendered short compositions, duration constraints, and template configurations. |
| `/productions/new` | **New Production** | Initialize Short from selected clips; choose template (`Ranking` vs `Single Title`) & layout. |
| `/productions/[id]` | **Production Studio** | Clip sequencer (`[▲]` / `[▼]`), per-clip trim overrides, AI YouTube Metadata Assistant, "Render Short" trigger. |
| `/renders` | **Renders Gallery** | Output library of deterministic MP4s, 9:16 video player modal, download buttons. |
| `/publishing` | **YouTube Publisher** | Multi-channel OAuth2 management and direct YouTube Shorts publishing. |

---

## 📥 Ingestion Modes

When adding video content, you can choose between:

### 1. YouTube Video URL
- Ingest single URLs or batch paste multiple URLs.
- Select category tags (e.g. *Family Guy*, *Podcast*, *Comedy*, *Gaming*).
- Background worker downloads, generates word-level Whisper transcription, and runs Gemini AI highlight scoring.

### 2. Upload Video File (Local MP4)
- **Single Clip**: Imports the entire video as 1 editable clip candidate directly into the Clips Library (`/clips/edit`).
- **Full Episode / Video**:
  - **Manual Cuts (Timestamp Mode)**: Define exact highlight cuts with custom titles and timestamps (e.g. `00:26:32` to `00:27:50` and `00:28:50` to `00:30:50`). Supports `HH:MM:SS`, `MM:SS`, or raw seconds.
  - **AI Discovery Mode**: Uploads the episode and hands it to the speech transcription and Gemini highlight discovery pipeline.

---

## 🎛️ Modular Templates

### 🔥 1. Viral Ranking Template (`RankingTemplateRenderer`)
- Designed for "Top N" countdowns and compilations.
- Animated countdown badge (#N..#1) sliding in at the start of each clip.
- Synchronized swoosh sound effects on transitions.
- Dynamic rank-reveal overlays with styled pop karaoke subtitles.
- Persistent top category & hook banner.

### ⚡ 2. Single Title Template (`SingleTitleTemplateRenderer`)
- Designed for focused standalone moments, podcast rants, or viral punchlines.
- Persistent hook title banner throughout the short.
- High-contrast, word-by-word karaoke speech captions with full emoji support.
- No countdown numbers or ranking overlays.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python 3.10+**
- **Node.js 18+ or 20+** and `npm`
- **FFmpeg** (installed and available in `PATH`)
- **Redis** (for Celery background worker)
- **MySQL 8.0**
- Google Gemini API Key ([aistudio.google.com](https://aistudio.google.com/))

---

### 🪟 Windows Setup (via WSL2 Ubuntu - Recommended)

Windows users should run this project inside **WSL2** for native Linux performance:

#### 1. Install WSL2 & Ubuntu
Open PowerShell as Administrator:
```powershell
wsl --install
```
*Restart your PC when prompted.*

#### 2. Install System Dependencies
Open your Ubuntu/WSL terminal:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv ffmpeg redis-server mysql-server nodejs npm git
```

#### 3. Start Redis & MySQL
```bash
sudo service redis-server start
sudo service mysql start

# Create MySQL database & user (default credentials)
sudo mysql -e "
  CREATE DATABASE IF NOT EXISTS shorts_db;
  CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY 'password';
  GRANT ALL PRIVILEGES ON shorts_db.* TO 'root'@'127.0.0.1';
  FLUSH PRIVILEGES;
"
```

#### 4. Clone & Setup Python Virtual Environment
```bash
git clone https://github.com/MalsTheDev/AI-Youtube-Shorts-Generator.git
cd AI-Youtube-Shorts-Generator

python3 -m venv venv
source venv/bin/activate
pip install -r requirements-local.txt
pip install pymysql "celery[redis]"
```

#### 5. Configure Environment Variables
```bash
cp .env.example .env
nano .env
```
Ensure your `.env` contains:
```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
LOCAL_WHISPER_MODEL=base
LOCAL_WHISPER_DEVICE=auto
LOCAL_OUTPUT_DIR=output
DATABASE_URL=mysql+pymysql://root:password@127.0.0.1:3307/shorts_db
```

#### 6. Initialize Database & Install Frontend
```bash
python3 init_db.py
cd frontend && npm install && cd ..
```

#### 7. Launch Everything
```bash
chmod +x start.sh
./start.sh
```

---

### 🐧 Linux / macOS Setup

```bash
# 1. Clone repository
git clone https://github.com/MalsTheDev/AI-Youtube-Shorts-Generator.git
cd AI-Youtube-Shorts-Generator

# 2. Virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-local.txt
pip install pymysql "celery[redis]"

# 3. Environment configuration
cp .env.example .env
# Edit .env and set GEMINI_API_KEY

# 4. Initialize Database
python3 init_db.py

# 5. Frontend dependencies
cd frontend && npm install && cd ..

# 6. Start Studio
chmod +x start.sh
./start.sh
```

---

## 🌐 Services & Ports

Once started with `./start.sh`, the following services will be active:

| Service | URL / Port | Purpose |
|---|---|---|
| **Studio UI** | [http://localhost:3000](http://localhost:3000) | Next.js Frontend Studio |
| **FastAPI Backend** | [http://localhost:8000](http://localhost:8000) | REST API & Stream Handler |
| **API Docs (Swagger)**| [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive API Documentation |
| **Celery Worker** | Background (Concurrency: 3) | Video download & transcription tasks |
| **Redis** | `localhost:6379` | Task broker & message store |
| **MySQL** | `localhost:3307` or `3306` | Persistent metadata & clip storage |

---

## 🛠️ REST API Reference

The backend provides a complete set of REST endpoints for programmatic workflows:

### Sources (`/api/sources`)
- `GET /api/sources`: List all ingested source videos with pipeline progress.
- `POST /api/sources`: Ingest long-form YouTube video(s).
- `POST /api/sources/upload`: Upload local MP4 video (`single_clip`, `manual_cuts`, or `ai_discovery`).
- `GET /api/sources/{id}`: Detailed source inspection with full transcript.
- `GET /api/sources/{id}/thumbnail`: On-demand lightweight source thumbnail JPEG.
- `DELETE /api/sources/{id}`: Delete source and associated clips.

### Clips Asset Library (`/api/clips`)
- `GET /api/clips`: Filter and paginate clips (supports search, category, favorites, status).
- `GET /api/clips/{id}`: Retrieve clip details, timing, and source streaming URL.
- `GET /api/clips/{id}/thumbnail`: On-demand lightweight clip thumbnail JPEG (~0.03s generation).
- `PATCH /api/clips/{id}`: Non-destructive metadata edit (trim `start_time`/`end_time`, rename, favorite).
- `DELETE /api/clips/{id}`: Remove or archive clip.

### Productions & Rendering (`/api/productions`)
- `GET /api/productions`: List draft and rendered productions.
- `POST /api/productions`: Create a new production composition from selected clips.
- `GET /api/productions/{id}`: Fetch production sequence, clip timing overrides, and metadata.
- `PATCH /api/productions/{id}`: Update title, description, template, tags, or reorder clips.
- `POST /api/productions/{id}/ai-metadata`: Generate viral title, description, and hashtags via Gemini.
- `POST /api/productions/{id}/render`: Trigger deterministic rendering engine with SHA-256 caching.
- `GET /api/renders`: Gallery of completed MP4 short outputs.

---

## ⚙️ Configuration Reference (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(Required)* | Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model for highlight scoring & metadata |
| `LLM_PROVIDER` | `gemini` | `gemini` or `openai` |
| `LOCAL_WHISPER_MODEL`| `base` | Whisper model: `tiny`, `base`, `small`, `medium`, `large` |
| `LOCAL_WHISPER_DEVICE`| `auto` | `auto`, `cpu`, or `cuda` |
| `LOCAL_OUTPUT_DIR` | `output` | Root directory for video downloads, uploads, and renders |
| `DATABASE_URL` | `mysql+pymysql://root:password@127.0.0.1:3307/shorts_db` | MySQL connection string |

---

## 📄 License

MIT — Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
