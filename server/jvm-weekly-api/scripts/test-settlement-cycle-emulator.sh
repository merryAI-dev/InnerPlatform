#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JVM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$JVM_DIR/../.." && pwd)"
PROJECT_ID="${FIREBASE_PROJECT_ID:-demo-jvm-settlement-cycle-it}"
FIRESTORE_PORT="${FIRESTORE_EMULATOR_PORT:-8181}"
ORIGINAL_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$HOME/.cache/firebase/emulators}"
TMP_CONFIG=""
TMP_HOME=""

case "$PROJECT_ID" in
  demo-?*) ;;
  *)
    printf '[jvm-settlement-emulator] Refusing non-demo project: %s\n' "$PROJECT_ID" >&2
    exit 1
    ;;
esac

if command -v brew >/dev/null 2>&1 && brew --prefix openjdk@21 >/dev/null 2>&1; then
  PATH="$(brew --prefix openjdk@21)/bin:$PATH"
fi

FIREBASE_CLI="$ROOT_DIR/node_modules/.bin/firebase"
if [ ! -x "$FIREBASE_CLI" ]; then
  FIREBASE_CLI="$(command -v firebase || true)"
fi
if [ -z "$FIREBASE_CLI" ] || [ ! -x "$FIREBASE_CLI" ]; then
  printf '[jvm-settlement-emulator] firebase-tools is required. Run npm install first.\n' >&2
  exit 1
fi

MAVEN_BIN="$(command -v mvn || true)"
if [ -z "$MAVEN_BIN" ]; then
  printf '[jvm-settlement-emulator] Maven is required.\n' >&2
  exit 1
fi

pick_free_port() {
  local port
  for port in "$@"; do
    if ! command -v lsof >/dev/null 2>&1 || ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      printf '%s\n' "$port"
      return 0
    fi
  done
  return 1
}

if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$FIRESTORE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  FIRESTORE_PORT="$(pick_free_port 8182 8183 8184 8185 8186 8187 8188 8189 8190 8281 8381 || true)"
  if [ -z "$FIRESTORE_PORT" ]; then
    printf '[jvm-settlement-emulator] No free Firestore emulator port found.\n' >&2
    exit 1
  fi
fi

cleanup() {
  if [ -n "${TMP_CONFIG:-}" ] && [ -f "$TMP_CONFIG" ]; then
    rm -f -- "$TMP_CONFIG"
  fi
  case "${TMP_HOME:-}" in
    "${TMPDIR:-/tmp}"/myscube-jvm-emulator-home.*)
      [ ! -d "$TMP_HOME" ] || rm -rf -- "$TMP_HOME"
      ;;
  esac
}
trap cleanup EXIT INT TERM

TMP_CONFIG="$(mktemp "${TMPDIR:-/tmp}/myscube-jvm-firestore.XXXXXX.json")"
TMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/myscube-jvm-emulator-home.XXXXXX")"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    emulators: {
      firestore: {host: "127.0.0.1", port: Number(process.argv[2])},
      ui: {enabled: false},
      singleProjectMode: true
    }
  }, null, 2));
' "$TMP_CONFIG" "$FIRESTORE_PORT"

TEST_COMMAND="cd '$JVM_DIR' && '$MAVEN_BIN' -q -Dtest=FirestoreSettlementCycleEmulatorIT test"

printf '[jvm-settlement-emulator] project=%s firestore=127.0.0.1:%s\n' \
  "$PROJECT_ID" "$FIRESTORE_PORT"
(
  cd "$TMP_HOME"
  env -i \
    HOME="$TMP_HOME" \
    PATH="$PATH" \
    TMPDIR="${TMPDIR:-/tmp}" \
    JAVA_HOME="${JAVA_HOME:-}" \
    JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:--Xms32m -Xmx1024m}" \
    CI="${CI:-1}" \
    FIREBASE_PROJECT_ID="$PROJECT_ID" \
    GOOGLE_CLOUD_PROJECT="$PROJECT_ID" \
    GCLOUD_PROJECT="$PROJECT_ID" \
    FIREBASE_EMULATORS_PATH="$ORIGINAL_EMULATORS_PATH" \
    "$FIREBASE_CLI" emulators:exec \
      --only firestore \
      --project "$PROJECT_ID" \
      --config "$TMP_CONFIG" \
      "$TEST_COMMAND"
)
