#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
CDP_URL="${CDP_URL:-http://127.0.0.1:9222}"

for _ in $(seq 1 30); do
  if curl -fsS "$CDP_URL/json/version" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$CDP_URL/json/version" >/dev/null || {
  echo "CDP endpoint is not reachable at $CDP_URL" >&2
  exit 1
}

if [ ! -d node_modules/playwright ]; then
  npm install --no-audit --no-fund
fi

CDP_URL="$CDP_URL" node playwright_test.mjs
