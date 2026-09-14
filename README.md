# 🎬 AI YouTube Shorts Generator

> Automatically turn any YouTube video into viral-ready Shorts with AI-powered clip selection, karaoke captions, animated overlays, and two template styles.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)

---

## ✨ What It Does

Paste a YouTube URL → the app downloads the video, uses **Gemini AI** to find the most viral moments, transcribes audio with **Whisper**, and compiles a polished Short with:

- 🔥 **Viral Ranking Template** — animated countdown (1–5) with sliding rank-reveal overlay, swoosh sounds, and tri-color title banner
- ⚡ **Single Title Template** — clean hook title at the top + karaoke word-by-word captions (no rank list)
- 🎨 **Karaoke captions** burned directly into the video (full-color emoji support)
- 📐 **3 layout modes** — 1:1 Square, 16:9 Full Ratio, 9:16 Full Screen
- 🖥️ **Review Studio** — edit clip titles, trim timestamps, reorder clips, pick template, and re-render in the browser

---

## 🗂️ Project Structure

```
AI-Youtube-Shorts-Generator/
├── server.py              # FastAPI backend (REST API + Celery task queue)
├── render_engine.py       # FFmpeg + Pillow video rendering engine
├── database.py            # SQLAlchemy MySQL models
├── main.py                # CLI entry point
├── frontend/              # Next.js 15 Review Studio UI
│   └── src/app/
│       ├── page.tsx       # Home / submit job
│       ├── queue/         # Batch queue monitor
│       ├── clips/         # Clips library browser
│       └── review/[jobId] # Per-job Review Studio
├── fonts/                 # Anton, NotoColorEmoji fonts
├── assets/                # Swoosh sound effect
├── output/                # Generated videos & job store (auto-created)
├── requirements-local.txt # Python dependencies
├── start.sh               # One-command start (Linux/macOS)
└── .env.example           # Environment variables template
```

---

## 🚀 Setup Guide

Choose your operating system:

- **[Windows (WSL2)](#-windows-setup-recommended)** ← Windows users start here
- **[Linux / macOS](#-linux--macos-setup)**

---

## 🪟 Windows Setup (Recommended)

Windows users run this project inside **WSL2** (Windows Subsystem for Linux). This gives you a full Ubuntu environment inside Windows — no dual-boot required.

### Step 1 — Install WSL2 + Ubuntu

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

This installs WSL2 and Ubuntu automatically. **Restart your computer** when prompted.

After restart, Ubuntu will open and ask you to create a username and password (just for WSL — pick anything you like).

> 💡 After setup, you can open WSL any time by searching **"Ubuntu"** in the Start Menu, or typing `wsl` in PowerShell.

---

### Step 2 — Install System Dependencies (inside Ubuntu/WSL)

Open the **Ubuntu** terminal and run these commands:

```bash
# Update package list
sudo apt update && sudo apt upgrade -y

# Python 3.10+
sudo apt install -y python3 python3-pip python3-venv

# FFmpeg (video processing — required)
sudo apt install -y ffmpeg

# Redis (task queue — required)
sudo apt install -y redis-server

# MySQL Server
sudo apt install -y mysql-server

# Node.js 20 (for the frontend UI)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Git
sudo apt install -y git
```

Verify everything installed:

```bash
python3 --version    # should say 3.10 or higher
ffmpeg -version      # should print FFmpeg version info
node --version       # should say v20.x
redis-cli ping       # should reply PONG
```

---

### Step 3 — Set Up MySQL

```bash
# Start MySQL service
sudo service mysql start

# Create the database and user
sudo mysql -e "
  CREATE DATABASE IF NOT EXISTS shorts_db;
  CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY 'password';
  GRANT ALL PRIVILEGES ON shorts_db.* TO 'root'@'127.0.0.1';
  FLUSH PRIVILEGES;
"
```

> ⚠️ The default password used in this project is `password`. You can change it in `.env` later — just make sure it matches everywhere.

---

### Step 4 — Clone the Repository

```bash
# Navigate to your home folder
cd ~

# Clone the repo (use the URL your friend shared with you)
git clone https://github.com/MalsTheDev/AI-Youtube-Shorts-Generator.git
cd AI-Youtube-Shorts-Generator
```

---

### Step 5 — Create the Python Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate

# Install all Python dependencies
pip install -r requirements-local.txt

# Install MySQL driver and Celery
pip install pymysql "celery[redis]"
```

---

### Step 6 — Configure Environment Variables

```bash
# Copy the example config file
cp .env.example .env

# Open it in nano (a simple terminal text editor)
nano .env
```

Fill in your values:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
LOCAL_WHISPER_MODEL=base
LOCAL_WHISPER_DEVICE=auto
LOCAL_OUTPUT_DIR=output
```

Save with `Ctrl+O` → `Enter`, then exit with `Ctrl+X`.

> 🔑 **How to get a free Gemini API key:**
> 1. Go to [aistudio.google.com](https://aistudio.google.com/)
> 2. Sign in with your Google account
> 3. Click **"Get API Key"** → **"Create API key"**
> 4. Copy the key and paste it into `.env`

---

### Step 7 — Initialize the Database

```bash
python3 init_db.py
```

You should see: `Database tables created successfully.`

---

### Step 8 — Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

---

### Step 9 — Start Everything

```bash
# Make the start script executable (first time only)
chmod +x start.sh

# Start all services
./start.sh
```

You'll see:

```
🚀 Studio UI:      http://localhost:3000
📦 Batch Queue:    http://localhost:3000/queue
🎬 Clips Library:  http://localhost:3000/clips
🔌 API Docs:       http://localhost:8000/docs
```

Open **http://localhost:3000** in your Windows browser (Chrome, Edge, or Firefox — all work fine with WSL2).

> 💡 WSL2 automatically bridges `localhost` to Windows, so opening the browser on Windows just works.

---

### Step 10 — Generate Your First Short

1. Open **http://localhost:3000**
2. Paste any YouTube URL (a podcast, sitcom clip, sports highlight, etc.)
3. Choose number of clips (3–5 recommended)
4. Click **Generate Shorts**
5. When done, click **Review** to open the Review Studio
6. Pick your template (**Viral Ranking** or **Single Title**)
7. Adjust clip titles, trim timestamps if needed
8. Click **Render** and wait ~1–2 minutes
9. Download your finished Short!

---

## 🐧 Linux / macOS Setup

### Install Dependencies

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install -y python3 python3-pip python3-venv ffmpeg redis-server mysql-server nodejs npm git
```

**macOS (Homebrew):**
```bash
brew install python ffmpeg redis mysql node git
```

### Clone & Setup

```bash
git clone https://github.com/MalsTheDev/AI-Youtube-Shorts-Generator.git
cd AI-Youtube-Shorts-Generator

python3 -m venv venv
source venv/bin/activate
pip install -r requirements-local.txt
pip install pymysql "celery[redis]"

cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

python3 init_db.py

cd frontend && npm install && cd ..

./start.sh
```

Open **http://localhost:3000**.

---

## ⚙️ Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ Yes | Google AI Studio API key — free at [aistudio.google.com](https://aistudio.google.com/) |
| `GEMINI_MODEL` | No | Model to use. Default: `gemini-2.5-flash` |
| `LLM_PROVIDER` | No | `gemini` (default) or `openai` |
| `OPENAI_API_KEY` | Only if using OpenAI | Your OpenAI secret key |
| `OPENAI_MODEL` | No | Default: `gpt-4o-mini` |
| `LOCAL_WHISPER_MODEL` | No | `tiny`, `base`, `small`, `medium`, or `large`. Default: `base` |
| `LOCAL_WHISPER_DEVICE` | No | `auto`, `cpu`, or `cuda`. Default: `auto` |
| `LOCAL_OUTPUT_DIR` | No | Folder for output videos. Default: `output` |

---

## 🎛️ Template Styles

### 🔥 Viral Ranking
The classic countdown format. Each clip slides in with its rank number and title, accompanied by a swoosh sound. Tri-color animated banner at the top. Best for "Top 5 moments" content.

### ⚡ Single Title
One bold white hook title displayed at the top throughout the whole video, with karaoke captions synced word-by-word to speech. No rank numbers or countdown. Best for single-topic highlights (e.g. "BRIAN OWES STEWIE MONEY").

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `ffmpeg: command not found` | `sudo apt install ffmpeg` |
| `redis connection refused` | `sudo service redis-server start` |
| `MySQL connection failed` | `sudo service mysql start`, then re-run `python3 init_db.py` |
| `npm: command not found` | Re-run the Node.js install step |
| `Port 3000 already in use` | `kill $(lsof -t -i:3000)` then retry |
| Video stuck at "Processing" | Check Celery started — look for `[celery@...] ready.` in terminal |
| Whisper is very slow | Set `LOCAL_WHISPER_MODEL=tiny` in `.env` for faster (less accurate) transcription |

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| AI / LLM | Google Gemini 2.5 Flash |
| Transcription | faster-whisper (OpenAI Whisper) |
| Video download | yt-dlp |
| Video rendering | FFmpeg + Python Pillow |
| Backend API | FastAPI + Celery + Redis |
| Database | MySQL (SQLAlchemy ORM) |
| Frontend | Next.js 15 + Tailwind CSS |
| Fonts | Anton (titles) + Noto Color Emoji |

---

## 📄 License

MIT — see [LICENSE](LICENSE).
