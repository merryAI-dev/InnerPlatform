#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${FIREBASE_PROJECT_ID:-demo-bff-it}"
FIRESTORE_PORT="${FIRESTORE_EMULATOR_PORT:-8080}"
TMP_CONFIG=""

if command -v brew >/dev/null 2>&1; then
  if brew --prefix openjdk@21 >/dev/null 2>&1; then
    export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
  fi
fi

pick_free_port() {
  for p in "$@"; do
    if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

cleanup() {
  if [ -n "${TMP_CONFIG:-}" ] && [ -f "$TMP_CONFIG" ]; then
    rm -f "$TMP_CONFIG"
  fi
}
trap cleanup EXIT

if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"$FIRESTORE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    ALT_PORT="$(pick_free_port 8081 8082 8083 8084 8085 8086 8087 8088 8089 8090 8180 8280 || true)"
    if [ -z "${ALT_PORT:-}" ]; then
      printf "[bff-integration] Firestore emulator port %s is in use and no fallback port was found.\n" "$FIRESTORE_PORT"
      exit 1
    fi
    printf "[bff-integration] Firestore emulator port %s is busy. Using %s instead.\n" "$FIRESTORE_PORT" "$ALT_PORT"
    FIRESTORE_PORT="$ALT_PORT"
  fi
fi

TMP_CONFIG="$(mktemp "$ROOT_DIR/.firebase-bff-integration-XXXX.json")"
node -e "const fs=require('fs');const cfg=JSON.parse(fs.readFileSync('firebase.json','utf8'));cfg.emulators=cfg.emulators||{};cfg.emulators.firestore=cfg.emulators.firestore||{};cfg.emulators.firestore.port=Number(process.argv[2]);fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));" "$TMP_CONFIG" "$FIRESTORE_PORT"

printf "[bff-integration] Running Firestore emulator integration tests (project=%s, port=%s)\n" "$PROJECT_ID" "$FIRESTORE_PORT"

npx firebase-tools emulators:exec \
  --only firestore \
  --project "$PROJECT_ID" \
  --config "$TMP_CONFIG" \
  "npx vitest run --config vitest.bff-integration.config.ts"
