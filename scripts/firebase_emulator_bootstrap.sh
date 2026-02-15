#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

get_java_major_version() {
  local version_output
  version_output="$(java -version 2>&1 || true)"
  printf "%s" "$version_output" | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -n 1
}

java_major="$(get_java_major_version)"
if command -v brew >/dev/null 2>&1; then
  if [[ -z "$java_major" || "$java_major" -lt 21 ]]; then
    if brew --prefix openjdk@21 >/dev/null 2>&1; then
      export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
      java_major="$(get_java_major_version)"
    fi
  fi
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

project_id="${VITE_FIREBASE_PROJECT_ID:-demo-mysc}"
api_key="${VITE_FIREBASE_API_KEY:-demo-api-key}"
auth_domain="${VITE_FIREBASE_AUTH_DOMAIN:-${project_id}.firebaseapp.com}"
storage_bucket="${VITE_FIREBASE_STORAGE_BUCKET:-${project_id}.appspot.com}"
messaging_sender_id="${VITE_FIREBASE_MESSAGING_SENDER_ID:-000000000000}"
app_id="${VITE_FIREBASE_APP_ID:-1:000000000000:web:demo000000000000}"
org_id="${VITE_DEFAULT_ORG_ID:-mysc}"

cat > .env.local <<ENV
# Local Firebase emulator overrides (generated)
VITE_FIREBASE_API_KEY=${api_key}
VITE_FIREBASE_AUTH_DOMAIN=${auth_domain}
VITE_FIREBASE_PROJECT_ID=${project_id}
VITE_FIREBASE_STORAGE_BUCKET=${storage_bucket}
VITE_FIREBASE_MESSAGING_SENDER_ID=${messaging_sender_id}
VITE_FIREBASE_APP_ID=${app_id}
VITE_DEFAULT_ORG_ID=${org_id}
VITE_TENANT_ISOLATION_STRICT=true

VITE_FIREBASE_USE_ENV_CONFIG=true
VITE_FIREBASE_AUTH_ENABLED=true
VITE_FIRESTORE_CORE_ENABLED=true
VITE_FIREBASE_USE_EMULATORS=true
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1
VITE_FIRESTORE_EMULATOR_PORT=8080
VITE_FIREBASE_AUTH_EMULATOR_PORT=9099
VITE_FIREBASE_STORAGE_EMULATOR_PORT=9199
VITE_PLATFORM_API_ENABLED=true
VITE_PLATFORM_API_BASE_URL=http://127.0.0.1:8787
ENV

cat > .firebaserc <<RC
{
  "projects": {
    "default": "${project_id}"
  }
}
RC

printf "[firebase-emulator-bootstrap] Generated .env.local and .firebaserc for '%s'\n" "$project_id"

if [[ "${1:-}" == "--start" ]]; then
  if [[ -z "$java_major" || "$java_major" -lt 21 ]]; then
    printf "[firebase-emulator-bootstrap] Java 21+ is required for Firestore emulator.\n"
    printf "Install Java 21 and rerun: npm run firebase:emulators:start\n"
    exit 3
  fi
  printf "[firebase-emulator-bootstrap] Starting Firebase emulators...\n"
  exec npx firebase-tools emulators:start --only auth,firestore,storage --project "$project_id"
fi

printf "[firebase-emulator-bootstrap] Next:\n"
printf "  1) npm run firebase:emulators:start\n"
printf "  2) npm run dev\n"
