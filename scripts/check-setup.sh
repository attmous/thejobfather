#!/bin/sh
# Optional prerequisite check for macOS / Linux. Windows users can run the
# three docker commands below directly in PowerShell.
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is missing from PATH. Install and open Docker Desktop, then reopen your terminal."
  echo "https://docs.docker.com/compose/install/"
  exit 1
fi
docker --version
if ! docker compose version; then
  echo "Install Docker Compose v2 or newer (included in Docker Desktop)."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed, but its engine is not ready. Open Docker Desktop and wait for it to start."
  exit 1
fi
echo "Ready. Run: docker compose up --build -d --wait"
