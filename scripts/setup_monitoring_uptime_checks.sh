#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${MONITORING_PROJECT_ID:-${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-inner-platform-live-20260316}}}"
WEB_HOST="${MONITORING_WEB_HOST:-inner-platform.vercel.app}"
WEB_PATH="${MONITORING_WEB_PATH:-/login}"
HEALTH_PATH="${MONITORING_HEALTH_PATH:-/api/v1/health}"
PERIOD_MINUTES="${MONITORING_UPTIME_PERIOD_MINUTES:-5}"
TIMEOUT_SECONDS="${MONITORING_UPTIME_TIMEOUT_SECONDS:-10}"

WEB_DISPLAY_NAME="${MONITORING_WEB_DISPLAY_NAME:-inner-platform production login}"
HEALTH_DISPLAY_NAME="${MONITORING_HEALTH_DISPLAY_NAME:-inner-platform bff health}"

find_existing_check() {
  local display_name="$1"
  gcloud monitoring uptime list-configs --project "$PROJECT_ID" --format=json \
    | node -e '
      const fs = require("fs");
      const displayName = process.argv[1];
      const items = JSON.parse(fs.readFileSync(0, "utf8") || "[]");
      const found = items.find((item) => item && item.displayName === displayName);
      if (found?.name) process.stdout.write(found.name);
    ' "$display_name"
}

recreate_check() {
  local display_name="$1"
  shift

  local existing
  existing="$(find_existing_check "$display_name")"
  if [[ -n "$existing" ]]; then
    printf "[monitoring-uptime] deleting existing check: %s (%s)\n" "$display_name" "$existing"
    gcloud monitoring uptime delete "$existing" --project "$PROJECT_ID" --quiet >/dev/null
  fi

  printf "[monitoring-uptime] creating check: %s\n" "$display_name"
  gcloud monitoring uptime create "$display_name" \
    --project "$PROJECT_ID" \
    "$@"
}

printf "[monitoring-uptime] project=%s host=%s period=%sm timeout=%ss\n" \
  "$PROJECT_ID" "$WEB_HOST" "$PERIOD_MINUTES" "$TIMEOUT_SECONDS"

recreate_check \
  "$WEB_DISPLAY_NAME" \
  --resource-type=uptime-url \
  --resource-labels="host=${WEB_HOST},project_id=${PROJECT_ID}" \
  --protocol=https \
  --path="$WEB_PATH" \
  --request-method=get \
  --period="$PERIOD_MINUTES" \
  --timeout="$TIMEOUT_SECONDS" \
  --validate-ssl=true \
  --status-codes=200 \
  --matcher-type=contains-string \
  --matcher-content='id="root"'

recreate_check \
  "$HEALTH_DISPLAY_NAME" \
  --resource-type=uptime-url \
  --resource-labels="host=${WEB_HOST},project_id=${PROJECT_ID}" \
  --protocol=https \
  --path="$HEALTH_PATH" \
  --request-method=get \
  --period="$PERIOD_MINUTES" \
  --timeout="$TIMEOUT_SECONDS" \
  --validate-ssl=true \
  --status-codes=200 \
  --matcher-type=contains-string \
  --matcher-content='"ok":true'

printf "[monitoring-uptime] done\n"
