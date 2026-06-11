#!/usr/bin/env bash
# Launch the full stack, each service in its own terminal window.
#
# Windows (Git Bash):  ./startup.sh        — opens two new Git Bash windows
# macOS:               ./startup.sh        — opens two Terminal.app windows
# Linux:               ./startup.sh        — uses gnome-terminal / x-terminal-emulator
#
# Backend  → http://localhost:8000  (FastAPI + WebSocket)
# Frontend → http://localhost:3000  (Next.js; falls back to 3001 if 3000 is busy —
#            if so, set FRONTEND_ORIGIN=http://localhost:3001 in backend/.env so
#            confirmation links and OAuth redirects point at the right port)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_CMD="cd '$ROOT/backend' && '$ROOT/.venv/Scripts/python.exe' -m uvicorn app.main:app --reload --port 8000"
FRONTEND_CMD="cd '$ROOT/frontend' && npm run dev"

launch() {
  local title="$1" cmd="$2"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      # New Git Bash window per service; window stays open if the process exits.
      # Empty "" is the window title slot — cmd's start mangles quoted titles
      # when invoked from bash, so the title is set with TERM_TITLE instead.
      TERM_TITLE="$title" cmd //c start "" bash -lc "echo -ne '\\033]0;'\$TERM_TITLE'\\007'; $cmd; echo; echo '[exited — press enter to close]'; read"
      ;;
    Darwin)
      osascript -e "tell application \"Terminal\" to do script \"$cmd\"" >/dev/null
      ;;
    Linux)
      if command -v gnome-terminal >/dev/null; then
        gnome-terminal --title="$title" -- bash -lc "$cmd; exec bash"
      else
        x-terminal-emulator -e bash -lc "$cmd; exec bash" &
      fi
      ;;
    *)
      echo "Unsupported platform: $(uname -s)" >&2
      exit 1
      ;;
  esac
  echo "launched: $title"
}

# macOS/Linux use the venv's posix python path instead of Scripts/
if [[ "$(uname -s)" == "Darwin" || "$(uname -s)" == "Linux" ]]; then
  BACKEND_CMD="cd '$ROOT/backend' && '$ROOT/.venv/bin/python' -m uvicorn app.main:app --reload --port 8000"
fi

launch "backtester-api" "$BACKEND_CMD"
launch "backtester-web" "$FRONTEND_CMD"

echo
echo "backend  → http://localhost:8000/api/health"
echo "frontend → http://localhost:3000"
