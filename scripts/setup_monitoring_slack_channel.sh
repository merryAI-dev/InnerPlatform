#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${MONITORING_PROJECT_ID:-${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-inner-platform-live-20260316}}}"
SLACK_AUTH_TOKEN="${MONITORING_SLACK_AUTH_TOKEN:-}"
SLACK_CHANNEL_NAME="${MONITORING_SLACK_CHANNEL_NAME:-}"
SLACK_DISPLAY_NAME="${MONITORING_SLACK_DISPLAY_NAME:-MYSC Ops Slack}"
SLACK_DESCRIPTION="${MONITORING_SLACK_DESCRIPTION:-Primary Slack channel for InnerPlatform production alerts}"

if [[ -z "$SLACK_AUTH_TOKEN" ]]; then
  printf "[monitoring-slack] MONITORING_SLACK_AUTH_TOKEN is required\n"
  exit 1
fi

if [[ -z "$SLACK_CHANNEL_NAME" ]]; then
  printf "[monitoring-slack] MONITORING_SLACK_CHANNEL_NAME is required\n"
  exit 1
fi

existing="$(gcloud beta monitoring channels list --project "$PROJECT_ID" --format=json \
  | node -e '
    const fs = require("fs");
    const displayName = process.argv[1];
    const channelName = process.argv[2];
    const items = JSON.parse(fs.readFileSync(0, "utf8") || "[]");
    const found = items.find((item) =>
      item
      && item.type === "slack"
      && (item.displayName === displayName || item.labels?.channel_name === channelName)
    );
    if (found?.name) process.stdout.write(found.name);
  ' "$SLACK_DISPLAY_NAME" "$SLACK_CHANNEL_NAME")"

if [[ -n "$existing" ]]; then
  printf "[monitoring-slack] deleting existing slack channel: %s\n" "$existing"
  gcloud beta monitoring channels delete "$existing" --project "$PROJECT_ID" --quiet >/dev/null
fi

printf "[monitoring-slack] creating slack channel for #%s in project=%s\n" "$SLACK_CHANNEL_NAME" "$PROJECT_ID"
created_json="$(gcloud beta monitoring channels create \
  --project "$PROJECT_ID" \
  --display-name="$SLACK_DISPLAY_NAME" \
  --description="$SLACK_DESCRIPTION" \
  --type=slack \
  --channel-labels="auth_token=${SLACK_AUTH_TOKEN},channel_name=${SLACK_CHANNEL_NAME}" \
  --format=json)"

channel_name="$(printf '%s' "$created_json" | node -e 'const fs=require("fs"); const obj=JSON.parse(fs.readFileSync(0,"utf8")||"{}"); if (obj.name) process.stdout.write(obj.name);')"

if [[ -z "$channel_name" ]]; then
  printf "[monitoring-slack] failed to create slack channel\n"
  exit 1
fi

printf "[monitoring-slack] created: %s\n" "$channel_name"
printf "[monitoring-slack] next: export MONITORING_NOTIFICATION_CHANNELS='%s' && npm run monitoring:setup:alerts\n" "$channel_name"
