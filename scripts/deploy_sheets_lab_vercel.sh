#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED_BRANCH="experiment/sheets-cashflow-projection-readonly"
TARGET_ALIAS="inner-platform-sheets-lab-merryai-devs-projects.vercel.app"
SHEETS_LAB_FIRESTORE_PROJECT_ID="${SHEETS_LAB_FIRESTORE_PROJECT_ID:-inner-platform-qa-20260310}"
SHEETS_LAB_FIREBASE_AUTH_PROJECT_ID="${SHEETS_LAB_FIREBASE_AUTH_PROJECT_ID:-mysc-bmp-14173451}"
CURRENT_BRANCH="$(git branch --show-current)"

fail() {
  echo "[deploy-sheets-lab-vercel] refused: $1" >&2
  exit 1
}

if [[ "$CURRENT_BRANCH" != "$REQUIRED_BRANCH" ]]; then
  echo "[deploy-sheets-lab-vercel] refused: current branch is '$CURRENT_BRANCH', expected '$REQUIRED_BRANCH'" >&2
  echo "[deploy-sheets-lab-vercel] this protects stage/live aliases from spreadsheet experiments"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  fail "working tree must be clean before assigning the fixed sheets-lab alias"
fi

git fetch --quiet origin "$REQUIRED_BRANCH"
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$REQUIRED_BRANCH")"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  fail "HEAD $(git rev-parse --short HEAD) does not match origin/$REQUIRED_BRANCH $(git rev-parse --short "origin/$REQUIRED_BRANCH")"
fi

TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

echo "[deploy-sheets-lab-vercel] deploying branch=$CURRENT_BRANCH alias=$TARGET_ALIAS"
echo "[deploy-sheets-lab-vercel] commit=$(git rev-parse --short HEAD)"
echo "[deploy-sheets-lab-vercel] bff firestore project=$SHEETS_LAB_FIRESTORE_PROJECT_ID"
echo "[deploy-sheets-lab-vercel] bff firebase auth project=$SHEETS_LAB_FIREBASE_AUTH_PROJECT_ID"
if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "[deploy-sheets-lab-vercel] dry run passed: branch, clean tree, and upstream HEAD match"
  exit 0
fi

vercel deploy \
  --yes \
  --archive=tgz \
  --env "FIREBASE_PROJECT_ID=$SHEETS_LAB_FIRESTORE_PROJECT_ID" \
  --env "BFF_FIREBASE_AUTH_PROJECT_ID=$SHEETS_LAB_FIREBASE_AUTH_PROJECT_ID" \
  2>&1 | tee "$TMP_OUTPUT"

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
ALIAS_TARGET="$(
  vercel inspect "https://$TARGET_ALIAS" 2>&1 \
    | perl -pe 's/\e\[[0-9;]*[A-Za-z]//g' \
    | sed -n 's/.*Fetched deployment "\([^"]*\)".*/\1/p' \
    | tail -1
)"

PREVIEW_HOST="$(node -e "console.log(new URL(process.argv[1]).host)" "$PREVIEW_URL")"
ALIAS_HOST="$(node -e "const value = process.argv[1]; console.log(new URL(value.startsWith('http') ? value : 'https://' + value).host)" "$ALIAS_TARGET")"
if [[ "$ALIAS_HOST" != "$PREVIEW_HOST" ]]; then
  fail "post-alias inspect mismatch: alias points to '$ALIAS_HOST', expected '$PREVIEW_HOST'"
fi

echo "[deploy-sheets-lab-vercel] done: https://$TARGET_ALIAS -> $PREVIEW_URL"
