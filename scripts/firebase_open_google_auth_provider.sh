#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

project_id="${1:-${VITE_FIREBASE_PROJECT_ID:-}}"
if [[ -z "$project_id" && -f .firebaserc ]]; then
  project_id="$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(".firebaserc","utf8"));process.stdout.write(j?.projects?.default||"")}catch{}')"
fi

if [[ -z "$project_id" ]]; then
  printf "[firebase-open-google-auth] Could not resolve Firebase project id.\n"
  printf "Pass it directly: bash scripts/firebase_open_google_auth_provider.sh <project-id>\n"
  exit 1
fi

url="https://console.firebase.google.com/project/${project_id}/authentication/providers"

if command -v open >/dev/null 2>&1; then
  open "$url" || true
fi

printf "%s\n" "$url"
