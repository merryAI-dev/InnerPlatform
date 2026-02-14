#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${FIREBASE_PROJECT_ID:-demo-bff-it}"

if command -v brew >/dev/null 2>&1; then
  if brew --prefix openjdk@21 >/dev/null 2>&1; then
    export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
  fi
fi

printf "[bff-integration] Running Firestore emulator integration tests (project=%s)\n" "$PROJECT_ID"

npx firebase-tools emulators:exec \
  --only firestore \
  --project "$PROJECT_ID" \
  "npx vitest run --config vitest.bff-integration.config.ts"
