#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  printf "Usage: bash scripts/firebase_fill_env_from_config.sh '<firebaseConfig-json>'\n"
  printf "Example JSON keys: apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId\n"
  exit 1
fi

json_input="$1"

lines=()
while IFS= read -r line; do
  [[ -n "$line" ]] && lines+=("$line")
done < <(RAW_JSON="$json_input" node - <<'NODE'
const raw = process.env.RAW_JSON || '';
let cfg;
try {
  cfg = JSON.parse(raw);
} catch (e) {
  console.error('Invalid JSON input for firebase config');
  process.exit(1);
}
const keys = ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'];
for (const k of keys) {
  console.log(`${k}=${typeof cfg[k] === 'string' ? cfg[k] : ''}`);
}
NODE
)

declare apiKey=""
declare authDomain=""
declare projectId=""
declare storageBucket=""
declare messagingSenderId=""
declare appId=""

for line in "${lines[@]}"; do
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    apiKey) apiKey="$value" ;;
    authDomain) authDomain="$value" ;;
    projectId) projectId="$value" ;;
    storageBucket) storageBucket="$value" ;;
    messagingSenderId) messagingSenderId="$value" ;;
    appId) appId="$value" ;;
  esac
done

cat > .env <<ENV
# Firebase runtime config (generated from pasted config)
VITE_FIREBASE_API_KEY=${apiKey}
VITE_FIREBASE_AUTH_DOMAIN=${authDomain}
VITE_FIREBASE_PROJECT_ID=${projectId}
VITE_FIREBASE_STORAGE_BUCKET=${storageBucket}
VITE_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}
VITE_FIREBASE_APP_ID=${appId}

# Org scope
VITE_DEFAULT_ORG_ID=mysc
VITE_TENANT_ISOLATION_STRICT=true

# Feature flags
VITE_FIREBASE_USE_ENV_CONFIG=true
VITE_FIREBASE_AUTH_ENABLED=true
VITE_FIRESTORE_CORE_ENABLED=true
VITE_FIREBASE_USE_EMULATORS=false
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1
VITE_FIRESTORE_EMULATOR_PORT=8080
VITE_FIREBASE_AUTH_EMULATOR_PORT=9099
VITE_FIREBASE_STORAGE_EMULATOR_PORT=9199
VITE_PLATFORM_API_ENABLED=false
VITE_PLATFORM_API_BASE_URL=http://127.0.0.1:8787
ENV

if [[ -n "$projectId" ]]; then
  cat > .firebaserc <<RC
{
  "projects": {
    "default": "${projectId}"
  }
}
RC
fi

printf "Updated .env"
if [[ -n "$projectId" ]]; then
  printf " and .firebaserc"
fi
printf "\n"
