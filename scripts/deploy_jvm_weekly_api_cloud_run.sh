#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

STAGE_GCP_PROJECT_ID="inner-platform-qa-20260310"
STAGE_SERVICE_NAME="innerplatform-jvm-weekly-api-lease-stage"
STAGE_FIREBASE_AUTH_PROJECT_ID="mysc-bmp-14173451"
STAGE_ALLOWED_ORIGIN="https://inner-platform-internal-stage-merryai-devs-projects.vercel.app"
STAGE_REGION="asia-northeast3"

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-}"
SERVICE_NAME="${SERVICE_NAME:-$STAGE_SERVICE_NAME}"
REGION="${REGION:-$STAGE_REGION}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"
FIRESTORE_PROJECT_ID="${JVM_WEEKLY_FIRESTORE_PROJECT_ID:-$STAGE_FIREBASE_AUTH_PROJECT_ID}"
AUTH_PROJECT_ID="${JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID:-$STAGE_FIREBASE_AUTH_PROJECT_ID}"
ALLOWED_ORIGINS="${JVM_WEEKLY_ALLOWED_ORIGINS:-$STAGE_ALLOWED_ORIGIN}"
STORAGE_BACKEND="${JVM_WEEKLY_STORAGE_BACKEND:-firestore}"
PROJECT_ACCESS_BACKEND="${JVM_WEEKLY_PROJECT_ACCESS_BACKEND:-firestore}"
DEPLOY_ENV="${JVM_WEEKLY_DEPLOY_ENV:-stage}"
EDIT_LEASES_ENABLED="${JVM_WEEKLY_EDIT_LEASES_ENABLED:-true}"
INTERNAL_TOKEN_ENABLED="${JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED:-true}"
JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET="${JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET:-innerplatform-weekly-api-token}"

fail() {
  echo "[deploy-jvm-weekly-api] $1" >&2
  exit 1
}

[[ "$PROJECT_ID" == "$STAGE_GCP_PROJECT_ID" ]] \
  || fail "Stage-only JVM deploy requires project $STAGE_GCP_PROJECT_ID"
[[ -z "${FIREBASE_PROJECT_ID:-}" || "$FIREBASE_PROJECT_ID" == "$STAGE_FIREBASE_AUTH_PROJECT_ID" ]] \
  || fail "Stage-only JVM deploy forbids a non-Stage data FIREBASE_PROJECT_ID"
[[ "$SERVICE_NAME" == "$STAGE_SERVICE_NAME" ]] \
  || fail "Stage-only JVM deploy requires service $STAGE_SERVICE_NAME"
[[ "$REGION" == "$STAGE_REGION" ]] \
  || fail "Stage-only JVM deploy requires region $STAGE_REGION"
[[ -z "${JVM_WEEKLY_SMOKE_URL:-}" ]] \
  || fail "Stage-only JVM deploy forbids smoke URL overrides"
[[ -z "${JVM_WEEKLY_API_BASE_URL:-}" ]] \
  || fail "Stage-only JVM deploy forbids JVM API URL overrides"
[[ "$FIRESTORE_PROJECT_ID" == "$STAGE_FIREBASE_AUTH_PROJECT_ID" ]] \
  || fail "Stage-only JVM deploy requires Firestore project $STAGE_FIREBASE_AUTH_PROJECT_ID"
[[ "$AUTH_PROJECT_ID" == "$STAGE_FIREBASE_AUTH_PROJECT_ID" ]] \
  || fail "Stage-only JVM deploy requires Firebase Auth project $STAGE_FIREBASE_AUTH_PROJECT_ID"
[[ "$ALLOWED_ORIGINS" == "$STAGE_ALLOWED_ORIGIN" ]] \
  || fail "Stage-only JVM deploy requires origin $STAGE_ALLOWED_ORIGIN"
[[ "$STORAGE_BACKEND" == "firestore" ]] \
  || fail "Stage-only JVM deploy requires the Firestore storage backend"
[[ "$PROJECT_ACCESS_BACKEND" == "firestore" ]] \
  || fail "Stage-only JVM deploy requires Firestore project access"
[[ "$DEPLOY_ENV" == "stage" && "$EDIT_LEASES_ENABLED" == "true" && "$INTERNAL_TOKEN_ENABLED" == "true" ]] \
  || fail "Stage-only JVM deploy requires the Stage lease and service-token runtime"
[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || fail "Stage-only JVM deploy received an invalid image tag"

IMAGE_URI="gcr.io/${PROJECT_ID}/${STAGE_SERVICE_NAME}:${IMAGE_TAG}"
echo "[deploy-jvm-weekly-api] project=${PROJECT_ID} region=${REGION} service=${SERVICE_NAME} image=${IMAGE_URI}"

mvn -f server/jvm-weekly-api/pom.xml test
mvn -f server/jvm-weekly-api/pom.xml -DskipTests package
docker build --platform linux/amd64 -f server/jvm-weekly-api/Dockerfile.runtime -t "$IMAGE_URI" .
docker push "$IMAGE_URI"

gcloud run deploy "$STAGE_SERVICE_NAME" \
  --project "$STAGE_GCP_PROJECT_ID" \
  --image "$IMAGE_URI" \
  --region "$STAGE_REGION" \
  --platform managed \
  --ingress all \
  --allow-unauthenticated \
  --set-env-vars "^|^WEEKLY_API_PORT=8080|JVM_WEEKLY_DEPLOY_ENV=stage|JVM_WEEKLY_EDIT_LEASES_ENABLED=true|JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED=true|JVM_WEEKLY_STORAGE_BACKEND=firestore|JVM_WEEKLY_PROJECT_ACCESS_BACKEND=firestore|JVM_WEEKLY_AUTH_MODE=strict|JVM_WEEKLY_WORKSPACE_EMAIL_DOMAIN=mysc.co.kr|JVM_WEEKLY_FIREBASE_PROJECT_ID=mysc-bmp-14173451|JVM_WEEKLY_FIRESTORE_PROJECT_ID=mysc-bmp-14173451|JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID=mysc-bmp-14173451|JVM_WEEKLY_ALLOWED_ORIGINS=https://inner-platform-internal-stage-merryai-devs-projects.vercel.app" \
  --set-secrets "JVM_WEEKLY_INTERNAL_API_TOKEN=${JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET}:latest"

SERVICE_URL="$(gcloud run services describe "$STAGE_SERVICE_NAME" \
  --project "$STAGE_GCP_PROJECT_ID" \
  --region "$STAGE_REGION" \
  --format='value(status.url)')"
node scripts/smoke_jvm_weekly_api.mjs --mode=deploy --base-url="$SERVICE_URL"

echo "[deploy-jvm-weekly-api] done"
