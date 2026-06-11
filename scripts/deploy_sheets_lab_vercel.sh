#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED_BRANCH="experiment/sheets-cashflow-projection-readonly"
TARGET_ALIAS="inner-platform-sheets-lab-merryai-devs-projects.vercel.app"
CURRENT_BRANCH="$(git branch --show-current)"

if [[ "$CURRENT_BRANCH" != "$REQUIRED_BRANCH" ]]; then
  echo "[deploy-sheets-lab-vercel] refused: current branch is '$CURRENT_BRANCH', expected '$REQUIRED_BRANCH'"
  echo "[deploy-sheets-lab-vercel] this protects stage/live aliases from spreadsheet experiments"
  exit 1
fi

TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

echo "[deploy-sheets-lab-vercel] deploying branch=$CURRENT_BRANCH alias=$TARGET_ALIAS"
vercel deploy --yes --archive=tgz 2>&1 | tee "$TMP_OUTPUT"

PREVIEW_URL="$(
  perl -pe 's/\e\[[0-9;]*[A-Za-z]//g' "$TMP_OUTPUT" \
    | grep -Eo 'https://[^ ]+\.vercel\.app' \
    | grep -v 'vercel.com/' \
    | tail -1
)"

if [[ -z "$PREVIEW_URL" ]]; then
  echo "[deploy-sheets-lab-vercel] failed: could not find preview URL in Vercel output"
  exit 1
fi

vercel alias set "$PREVIEW_URL" "$TARGET_ALIAS"
echo "[deploy-sheets-lab-vercel] done: https://$TARGET_ALIAS -> $PREVIEW_URL"
