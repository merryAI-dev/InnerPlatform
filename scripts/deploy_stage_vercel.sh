#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED_BRANCH="weekly-java-deployed-live-baseline"
TARGET_ALIAS="inner-platform-stage-merryai-devs-projects.vercel.app"
CURRENT_BRANCH="$(git branch --show-current)"

if [[ "$CURRENT_BRANCH" != "$REQUIRED_BRANCH" ]]; then
  echo "[deploy-stage-vercel] refused: current branch is '$CURRENT_BRANCH', expected '$REQUIRED_BRANCH'"
  echo "[deploy-stage-vercel] this protects the fixed stage alias from experiment branches"
  exit 1
fi

TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

echo "[deploy-stage-vercel] deploying branch=$CURRENT_BRANCH alias=$TARGET_ALIAS"
vercel deploy --yes --archive=tgz 2>&1 | tee "$TMP_OUTPUT"

PREVIEW_URL="$(
  perl -pe 's/\e\[[0-9;]*[A-Za-z]//g' "$TMP_OUTPUT" \
    | grep -Eo 'https://[^ ]+\.vercel\.app' \
    | grep -v 'vercel.com/' \
    | tail -1
)"

if [[ -z "$PREVIEW_URL" ]]; then
  echo "[deploy-stage-vercel] failed: could not find preview URL in Vercel output"
  exit 1
fi

vercel alias set "$PREVIEW_URL" "$TARGET_ALIAS"
echo "[deploy-stage-vercel] done: https://$TARGET_ALIAS -> $PREVIEW_URL"
