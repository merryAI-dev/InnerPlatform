#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$node_major" != "20" && "$node_major" != "22" && "$node_major" != "24" ]]; then
  printf "[firebase-bootstrap] Warning: firebase-tools recommends Node 20/22/24 (current: %s)\n" "$node_major"
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

REQUIRED_ENV_VARS=(
  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
  VITE_FIREBASE_STORAGE_BUCKET
  VITE_FIREBASE_MESSAGING_SENDER_ID
  VITE_FIREBASE_APP_ID
)

missing_vars=()
for var_name in "${REQUIRED_ENV_VARS[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing_vars+=("$var_name")
  fi
done

if (( ${#missing_vars[@]} > 0 )); then
  printf "[firebase-bootstrap] Missing required .env values:\n"
  for var_name in "${missing_vars[@]}"; do
    printf -- "- %s\n" "$var_name"
  done
  printf "\nFill .env first, then rerun: npm run firebase:bootstrap\n"
  exit 1
fi

cat > .firebaserc <<RC
{
  "projects": {
    "default": "${VITE_FIREBASE_PROJECT_ID}"
  }
}
RC

printf "[firebase-bootstrap] Wrote .firebaserc for project '%s'\n" "$VITE_FIREBASE_PROJECT_ID"

login_output="$(npx firebase-tools login:list 2>&1 || true)"
printf "%s\n" "$login_output"

if [[ "$login_output" == *"No authorized accounts"* ]]; then
  printf "\n[firebase-bootstrap] Firebase login is required.\n"
  printf "Run: npm run firebase:login\n"
  printf "Then rerun: npm run firebase:bootstrap\n"
  exit 2
fi

printf "[firebase-bootstrap] Selecting Firebase project...\n"
npx firebase-tools use "$VITE_FIREBASE_PROJECT_ID" --project "$VITE_FIREBASE_PROJECT_ID"

printf "[firebase-bootstrap] Deploying Firestore rules + indexes...\n"
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project "$VITE_FIREBASE_PROJECT_ID"

printf "\n[firebase-bootstrap] Done.\n"
