#!/usr/bin/env bash

echo "=================================================="
echo "      Stopping AI YouTube Shorts Generator        "
echo "=================================================="

echo -n "Stopping Next.js frontend... "
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
echo "Done."

echo -n "Stopping FastAPI backend (uvicorn)... "
pkill -f "uvicorn server:app" 2>/dev/null || true
echo "Done."

echo -n "Stopping Celery worker... "
pkill -f "celery -A server.celery_app worker" 2>/dev/null || true
echo "Done."

echo "All services stopped."
