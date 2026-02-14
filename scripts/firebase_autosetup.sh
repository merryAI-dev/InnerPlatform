#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$node_major" != "20" && "$node_major" != "22" && "$node_major" != "24" ]]; then
  printf "[firebase-autosetup] Warning: firebase-tools recommends Node 20/22/24 (current: %s)\n" "$node_major"
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

projects_json="$(npx firebase-tools projects:list --json 2>&1 || true)"
if [[ "$projects_json" == *"Failed to authenticate"* ]]; then
  printf "[firebase-autosetup] Firebase CLI login required.\n"
  printf "Run first: npm run firebase:login\n"
  exit 2
fi

project_id="${VITE_FIREBASE_PROJECT_ID:-${FIREBASE_PROJECT_ID:-}}"
if [[ -z "$project_id" ]]; then
  project_ids=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && project_ids+=("$line")
  done < <(RAW_JSON="$projects_json" node - <<'NODE'
const fs = require('fs');
const raw = process.env.RAW_JSON || '';
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
let data;
try {
  if (start === -1 || end === -1 || end <= start) process.exit(0);
  data = JSON.parse(raw.slice(start, end + 1));
} catch {
  process.exit(0);
}
const result = Array.isArray(data.result) ? data.result : [];
for (const project of result) {
  if (project && typeof project.projectId === 'string' && project.projectId) {
    console.log(project.projectId);
  }
}
NODE
)

  if (( ${#project_ids[@]} == 0 )); then
    printf "[firebase-autosetup] No Firebase projects found in your account.\n"
    printf "Create a project first in Firebase Console, then rerun.\n"
    exit 3
  elif (( ${#project_ids[@]} == 1 )); then
    project_id="${project_ids[0]}"
    printf "[firebase-autosetup] Using detected project: %s\n" "$project_id"
  else
    existing_default=""
    if [[ -f .firebaserc ]]; then
      existing_default="$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(".firebaserc","utf8"));process.stdout.write(j?.projects?.default||"")}catch{}')"
    fi

    if [[ -n "$existing_default" ]]; then
      for pid in "${project_ids[@]}"; do
        if [[ "$pid" == "$existing_default" ]]; then
          project_id="$existing_default"
          break
        fi
      done
    fi

    if [[ -z "$project_id" ]]; then
      project_id="${project_ids[0]}"
      printf "[firebase-autosetup] Multiple projects found. Using first detected project: %s\n" "$project_id"
    else
      printf "[firebase-autosetup] Multiple projects found. Using existing default project: %s\n" "$project_id"
    fi
  fi
fi

cat > .firebaserc <<RC
{
  "projects": {
    "default": "${project_id}"
  }
}
RC
printf "[firebase-autosetup] Wrote .firebaserc for '%s'\n" "$project_id"

apps_json="$(npx firebase-tools apps:list WEB --project "$project_id" --json 2>&1 || true)"
if [[ "$apps_json" == *"Failed to authenticate"* ]]; then
  printf "[firebase-autosetup] Auth expired. Run: npm run firebase:login\n"
  exit 5
fi

app_id="$(RAW_JSON="$apps_json" node - <<'NODE'
const raw = process.env.RAW_JSON || '';
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
let data;
try {
  if (start === -1 || end === -1 || end <= start) process.exit(0);
  data = JSON.parse(raw.slice(start, end + 1));
} catch {
  process.exit(0);
}
const result = Array.isArray(data.result) ? data.result : [];
if (result.length > 0 && typeof result[0].appId === 'string') {
  process.stdout.write(result[0].appId);
}
NODE
)"

if [[ -z "$app_id" ]]; then
  printf "[firebase-autosetup] No WEB app found. Creating one...\n"
  create_json="$(npx firebase-tools apps:create WEB "Business Management Platform" --project "$project_id" --json 2>&1 || true)"
  app_id="$(RAW_JSON="$create_json" node - <<'NODE'
const raw = process.env.RAW_JSON || '';
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
let data;
try {
  if (start === -1 || end === -1 || end <= start) process.exit(0);
  data = JSON.parse(raw.slice(start, end + 1));
} catch {
  process.exit(0);
}
if (data.result && typeof data.result.appId === 'string') {
  process.stdout.write(data.result.appId);
}
NODE
)"
fi

if [[ -z "$app_id" ]]; then
  printf "[firebase-autosetup] Failed to resolve Firebase WEB app id.\n"
  exit 6
fi

printf "[firebase-autosetup] Using app: %s\n" "$app_id"

sdk_json="$(npx firebase-tools apps:sdkconfig WEB "$app_id" --project "$project_id" --json 2>&1 || true)"

sdk_lines=()
while IFS= read -r line; do
  [[ -n "$line" ]] && sdk_lines+=("$line")
done < <(RAW_JSON="$sdk_json" node - <<'NODE'
const raw = process.env.RAW_JSON || '';
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
let data;
try {
  if (start === -1 || end === -1 || end <= start) process.exit(0);
  data = JSON.parse(raw.slice(start, end + 1));
} catch {
  process.exit(0);
}

const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
let cfg = null;

if (data.result && data.result.sdkConfig && typeof data.result.sdkConfig === 'object') {
  cfg = data.result.sdkConfig;
}

if (!cfg && data.result && typeof data.result.sdkConfig === 'string') {
  const str = data.result.sdkConfig;
  const m = str.match(/\{[\s\S]*\}/);
  if (m) {
    try { cfg = JSON.parse(m[0]); } catch {}
  }
}

if (!cfg && data.result && typeof data.result.config === 'object') {
  cfg = data.result.config;
}

if (!cfg) process.exit(0);

for (const key of keys) {
  const val = typeof cfg[key] === 'string' ? cfg[key] : '';
  console.log(`${key}=${val}`);
}
NODE
)

if (( ${#sdk_lines[@]} == 0 )); then
  printf "[firebase-autosetup] Failed to parse sdk config from Firebase CLI output.\n"
  printf "Run manually: npx firebase-tools apps:sdkconfig WEB %s --project %s\n" "$app_id" "$project_id"
  exit 7
fi

declare apiKey=""
declare authDomain=""
declare resolvedProjectId="$project_id"
declare storageBucket=""
declare messagingSenderId=""
declare appId=""

for line in "${sdk_lines[@]}"; do
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    apiKey) apiKey="$value" ;;
    authDomain) authDomain="$value" ;;
    projectId) resolvedProjectId="$value" ;;
    storageBucket) storageBucket="$value" ;;
    messagingSenderId) messagingSenderId="$value" ;;
    appId) appId="$value" ;;
  esac
done

cat > .env <<ENV
# Firebase runtime config (auto generated)
VITE_FIREBASE_API_KEY=${apiKey}
VITE_FIREBASE_AUTH_DOMAIN=${authDomain}
VITE_FIREBASE_PROJECT_ID=${resolvedProjectId}
VITE_FIREBASE_STORAGE_BUCKET=${storageBucket}
VITE_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}
VITE_FIREBASE_APP_ID=${appId}

# Org scope
VITE_DEFAULT_ORG_ID=${VITE_DEFAULT_ORG_ID:-mysc}
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

printf "[firebase-autosetup] .env updated from Firebase app config.\n"

npx firebase-tools use "$resolvedProjectId" --project "$resolvedProjectId"
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project "$resolvedProjectId"

printf "\n[firebase-autosetup] Done. Next: npm run dev\n"
