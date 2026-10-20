#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "      Starting AI YouTube Shorts Generator        "
echo "=================================================="

# 1. Check / Start Redis
echo -n "[1/5] Checking Redis... "
if redis-cli ping >/dev/null 2>&1; then
    echo "Running (Port 6379)"
else
    echo "Starting Redis server daemon..."
    redis-server --daemonize yes
    sleep 1
    if redis-cli ping >/dev/null 2>&1; then
        echo "Redis started successfully."
    else
        echo "ERROR: Failed to start Redis. Please check your Redis installation."
        exit 1
    fi
fi

# 2. Check / Start MySQL on port 3307
echo -n "[2/5] Checking MySQL (port 3307)... "
if ss -tulpn | grep -q ":3307 "; then
    echo "Running (Port 3307)"
else
    echo "Starting MySQL daemon on port 3307..."
    mysqld --no-defaults \
        --datadir=/var/tmp/mysql_data_shorts \
        --user=mals \
        --port=3307 \
        --bind-address=127.0.0.1 \
        --socket=/var/tmp/mysql_data_shorts/mysql.sock \
        --pid-file=/var/tmp/mysql_data_shorts/mysqld.pid \
        > /dev/null 2>&1 &
    
    # Wait for MySQL to become ready
    for i in {1..15}; do
        if ss -tulpn | grep -q ":3307 "; then
            break
        fi
        sleep 1
    done
    
    if ss -tulpn | grep -q ":3307 "; then
        echo "MySQL started successfully on port 3307."
    else
        echo "ERROR: Failed to start MySQL on port 3307."
        exit 1
    fi
fi

# Verify MySQL tables
./venv/bin/python init_db.py > /dev/null 2>&1 || true

# Cleanup trap to kill background processes on Ctrl+C
cleanup() {
    echo ""
    echo "Shutting down servers..."
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 3. Start Celery Worker
echo "[3/5] Starting Celery Worker (3x Concurrency)..."
PYTHONPATH=. ./venv/bin/celery -A server.celery_app worker --concurrency=3 --loglevel=info &
CELERY_PID=$!

# 4. Start FastAPI Backend
echo "[4/5] Starting FastAPI Backend on http://127.0.0.1:8000..."
./venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000 --reload &
FASTAPI_PID=$!

# Wait for FastAPI to start
sleep 2

# 5. Start Next.js Frontend
echo "[5/5] Starting Next.js Frontend on http://localhost:3000..."
echo "--------------------------------------------------"
echo "🚀 Studio UI:      http://localhost:3000"
echo "📹 Sources:        http://localhost:3000/sources"
echo "🎬 Clips Library:  http://localhost:3000/clips"
echo "🎞️ Productions:    http://localhost:3000/productions"
echo "📺 Renders:        http://localhost:3000/renders"
echo "🔌 API Docs:       http://localhost:8000/docs"
echo "--------------------------------------------------"
echo "Press Ctrl+C to stop all servers."
npm run dev --prefix frontend

wait
