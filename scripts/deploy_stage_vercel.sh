#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED_BRANCH="weekly-java-deployed-live-baseline"
TARGET_ALIAS="inner-platform-stage-merryai-devs-projects.vercel.app"
CURRENT_BRANCH="$(git branch --show-current)"

fail() {
  echo "[deploy-stage-vercel] refused: $1" >&2
  exit 1
}

if [[ "$CURRENT_BRANCH" != "$REQUIRED_BRANCH" ]]; then
  echo "[deploy-stage-vercel] refused: current branch is '$CURRENT_BRANCH', expected '$REQUIRED_BRANCH'" >&2
  echo "[deploy-stage-vercel] this protects the fixed stage alias from experiment branches"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  fail "working tree must be clean before assigning the fixed stage alias"
fi

git fetch --quiet origin "$REQUIRED_BRANCH"
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$REQUIRED_BRANCH")"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  fail "HEAD $(git rev-parse --short HEAD) does not match origin/$REQUIRED_BRANCH $(git rev-parse --short "origin/$REQUIRED_BRANCH")"
fi

TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

echo "[deploy-stage-vercel] deploying branch=$CURRENT_BRANCH alias=$TARGET_ALIAS"
echo "[deploy-stage-vercel] commit=$(git rev-parse --short HEAD)"
if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "[deploy-stage-vercel] dry run passed: branch, clean tree, and upstream HEAD match"
  exit 0
fi

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

echo "[deploy-stage-vercel] done: https://$TARGET_ALIAS -> $PREVIEW_URL"
