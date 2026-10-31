#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
URL="${FOUNDRY_URL:-http://127.0.0.1:4440}"
DATA="${FOUNDRY_DATA_DIR:-$ROOT/.tmp/verify}"
cmd="${1:-}"
shift || true

if [[ "$cmd" == "doctor" ]]; then
  health="$(curl -fsS "$URL/api/health")"
  printf '%s\n' "$health"
  printf '%s' "$health" | grep -q '"service":"idea-foundry"'
  port="${URL##*:}"
  listener="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  if [[ -z "${listener}" ]]; then
    echo "nothing is listening on ${port}" >&2
    exit 1
  fi
  echo "doctor ok ${URL} pid ${listener}"
  exit 0
fi

if [[ "$cmd" == "cli" ]]; then
  exec node "$ROOT/src/cli.ts" "$@" --data "$DATA"
fi

if [[ "$cmd" == "get" ]]; then
  exec curl -fsS "$URL${1:-/api/state}"
fi

if [[ "$cmd" == "post" ]]; then
  path="${1:-}"
  body="${2:-{\}}"
  exec curl -fsS -X POST "$URL$path" -H 'content-type: application/json' --data "$body"
fi

echo "use doctor, cli, get, or post" >&2
exit 1
