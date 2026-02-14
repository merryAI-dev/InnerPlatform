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
  printf "[firebase-deploy-indexes] Could not resolve Firebase project id.\n"
  printf "Pass directly: bash scripts/firebase_deploy_indexes.sh <project-id>\n"
  exit 1
fi

printf "[firebase-deploy-indexes] Deploying Firestore indexes to '%s'...\n" "$project_id"
npx firebase-tools deploy --only firestore:indexes --project "$project_id"
printf "[firebase-deploy-indexes] done\n"
