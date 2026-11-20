#!/bin/bash
# Double-click this file to start MultiSync. Close the window (or press Ctrl+C) to stop it.
cd "$(dirname "$0")" || exit 1
PORT=8080
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "Something is already running on port $PORT. Opening it in your browser."
  echo "If YouTube search asks for a key, close the other MultiSync window first, then run this again."
  open "http://localhost:$PORT"
  exit 0
fi
( sleep 1; open "http://localhost:$PORT" ) &
if command -v node >/dev/null 2>&1; then
  exec node server.js
else
  echo "Node.js was not found, so starting the basic server. Everything works except YouTube search without a key."
  exec python3 -m http.server "$PORT"
fi
