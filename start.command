#!/bin/bash
# Double-click this file to start MultiSync. Close the window (or press Ctrl+C) to stop it.
cd "$(dirname "$0")" || exit 1
PORT=8080
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "MultiSync is already running. Opening it in your browser."
  open "http://localhost:$PORT"
  exit 0
fi
echo "Starting MultiSync at http://localhost:$PORT"
echo "Keep this window open while you use it. Press Ctrl+C to stop."
( sleep 1; open "http://localhost:$PORT" ) &
exec python3 -m http.server "$PORT"
