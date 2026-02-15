#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

KEY_ID="${PII_KEY_ID:-v1}"
ENVIRONMENTS="${PII_VERCEL_ENVIRONMENTS:-production,preview,development}"
PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH=true
      shift
      ;;
    --key-id)
      KEY_ID="${2:-}"
      shift 2
      ;;
    --environments)
      ENVIRONMENTS="${2:-}"
      shift 2
      ;;
    *)
      printf "[pii-setup-vercel] Unknown argument: %s\n" "$1"
      exit 1
      ;;
  esac
done

if [[ -z "$KEY_ID" ]]; then
  printf "[pii-setup-vercel] --key-id is required\n"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  printf "[pii-setup-vercel] openssl is required\n"
  exit 1
fi

KEY_VALUE="$(openssl rand -base64 32 | tr -d '\n')"
KEYRING_NEW="${KEY_ID}:${KEY_VALUE}"

PII_ENV_FILE=".env.pii.local"
EXISTING_KEYRING=""
if [[ -f "$PII_ENV_FILE" ]]; then
  EXISTING_KEYRING="$(sed -n 's/^PII_LOCAL_KEYRING=//p' "$PII_ENV_FILE" | head -n 1)"
fi

KEYRING="$KEYRING_NEW"
if [[ -n "$EXISTING_KEYRING" ]]; then
  FILTERED_EXISTING="$(printf "%s" "$EXISTING_KEYRING" | tr ',' '\n' | grep -v "^${KEY_ID}:" || true)"
  if [[ -n "$FILTERED_EXISTING" ]]; then
    KEYRING="$(printf "%s,%s" "$(printf "%s" "$FILTERED_EXISTING" | paste -sd ',' -)" "$KEYRING_NEW")"
  fi
fi

cat > "$PII_ENV_FILE" <<EOF
# Local-only PII settings (generated)
PII_MODE=local
PII_LOCAL_CURRENT_KEY_ID=${KEY_ID}
PII_LOCAL_KEYRING=${KEYRING}
EOF

printf "[pii-setup-vercel] wrote %s\n" "$PII_ENV_FILE"

if [[ "$PUSH" == "true" ]]; then
  if ! command -v vercel >/dev/null 2>&1; then
    printf "[pii-setup-vercel] vercel CLI not found. Install first: npm i -g vercel\n"
    exit 2
  fi
  if ! vercel whoami >/dev/null 2>&1; then
    printf "[pii-setup-vercel] Vercel login is required: vercel login\n"
    exit 2
  fi
  if [[ ! -f ".vercel/project.json" ]]; then
    printf "[pii-setup-vercel] Project is not linked. Run once: vercel link\n"
    exit 2
  fi

  IFS=',' read -r -a env_list <<< "$ENVIRONMENTS"
  for env_name in "${env_list[@]}"; do
    env_trimmed="$(echo "$env_name" | xargs)"
    [[ -z "$env_trimmed" ]] && continue

    vercel env rm PII_MODE "$env_trimmed" --yes >/dev/null 2>&1 || true
    vercel env rm PII_LOCAL_CURRENT_KEY_ID "$env_trimmed" --yes >/dev/null 2>&1 || true
    vercel env rm PII_LOCAL_KEYRING "$env_trimmed" --yes >/dev/null 2>&1 || true

    printf "local\n" | vercel env add PII_MODE "$env_trimmed" >/dev/null
    printf "%s\n" "$KEY_ID" | vercel env add PII_LOCAL_CURRENT_KEY_ID "$env_trimmed" >/dev/null
    printf "%s\n" "$KEYRING" | vercel env add PII_LOCAL_KEYRING "$env_trimmed" >/dev/null

    printf "[pii-setup-vercel] pushed envs to Vercel (%s)\n" "$env_trimmed"
  done
fi

printf "\n[pii-setup-vercel] next\n"
printf "1) If not pushed yet: vercel env add PII_MODE <env>, PII_LOCAL_CURRENT_KEY_ID <env>, PII_LOCAL_KEYRING <env>\n"
printf "2) Redeploy your Vercel service\n"
printf "3) Run rotation when key changes: npm run pii:rotate\n"
