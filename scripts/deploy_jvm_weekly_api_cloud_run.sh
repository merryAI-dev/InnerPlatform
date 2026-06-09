#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REGION="${REGION:-asia-northeast3}"
SERVICE_NAME="${SERVICE_NAME:-innerplatform-jvm-weekly-api}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"
PROJECT_ID="${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
JVM_WEEKLY_DATABASE_URL="${JVM_WEEKLY_DATABASE_URL:-}"
JVM_WEEKLY_DATABASE_USER="${JVM_WEEKLY_DATABASE_USER:-innerplatform}"
JVM_WEEKLY_STORAGE_BACKEND="${JVM_WEEKLY_STORAGE_BACKEND:-firestore}"
JVM_WEEKLY_PROJECT_ACCESS_BACKEND="${JVM_WEEKLY_PROJECT_ACCESS_BACKEND:-firestore}"
JVM_WEEKLY_FIREBASE_PROJECT_ID="${JVM_WEEKLY_FIREBASE_PROJECT_ID:-$PROJECT_ID}"
JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID="${JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID:-$JVM_WEEKLY_FIREBASE_PROJECT_ID}"
JVM_WEEKLY_FIRESTORE_PROJECT_ID="${JVM_WEEKLY_FIRESTORE_PROJECT_ID:-$JVM_WEEKLY_FIREBASE_PROJECT_ID}"
JVM_WEEKLY_ALLOWED_ORIGINS="${JVM_WEEKLY_ALLOWED_ORIGINS:-https://inner-platform-stage-merryai-devs-projects.vercel.app,https://inner-platform.vercel.app}"
JVM_WEEKLY_DATABASE_PASSWORD_SECRET="${JVM_WEEKLY_DATABASE_PASSWORD_SECRET:-innerplatform-weekly-db-password}"
JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET="${JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET:-innerplatform-weekly-api-token}"
FIREBASE_WEB_API_KEY_SECRET="${FIREBASE_WEB_API_KEY_SECRET:-innerplatform-firebase-web-api-key}"
JVM_WEEKLY_SMOKE_EMAIL_SECRET="${JVM_WEEKLY_SMOKE_EMAIL_SECRET:-innerplatform-weekly-smoke-email}"
JVM_WEEKLY_SMOKE_PASSWORD_SECRET="${JVM_WEEKLY_SMOKE_PASSWORD_SECRET:-innerplatform-weekly-smoke-password}"
SERVERLESS_VPC_CONNECTOR="${SERVERLESS_VPC_CONNECTOR:-}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-}"
JVM_WEEKLY_SMOKE_URL="${JVM_WEEKLY_SMOKE_URL:-}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "[deploy-jvm-weekly-api] FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required"
  exit 1
fi
if [[ -z "$JVM_WEEKLY_DATABASE_URL" ]]; then
  echo "[deploy-jvm-weekly-api] JVM_WEEKLY_DATABASE_URL is required for stage deploy"
  exit 1
fi
if [[ "$JVM_WEEKLY_DATABASE_URL" == *"127.0.0.1"* || "$JVM_WEEKLY_DATABASE_URL" == *"localhost"* ]]; then
  echo "[deploy-jvm-weekly-api] JVM_WEEKLY_DATABASE_URL must not point at localhost for Cloud Run"
  exit 1
fi
if [[ -z "$JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID" ]]; then
  echo "[deploy-jvm-weekly-api] JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID is required for browser-direct auth"
  exit 1
fi
if [[ -z "$JVM_WEEKLY_FIRESTORE_PROJECT_ID" ]]; then
  echo "[deploy-jvm-weekly-api] JVM_WEEKLY_FIRESTORE_PROJECT_ID is required for Firestore storage"
  exit 1
fi

IMAGE_URI="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${IMAGE_TAG}"
NETWORK_ARGS=()
if [[ -n "$SERVERLESS_VPC_CONNECTOR" ]]; then
  NETWORK_ARGS+=(--vpc-connector "$SERVERLESS_VPC_CONNECTOR")
fi
if [[ -n "$CLOUD_SQL_INSTANCE" ]]; then
  NETWORK_ARGS+=(--add-cloudsql-instances "$CLOUD_SQL_INSTANCE")
fi

echo "[deploy-jvm-weekly-api] project=${PROJECT_ID} region=${REGION} service=${SERVICE_NAME} image=${IMAGE_URI}"

mvn -f server/jvm-weekly-api/pom.xml test
docker build -f server/jvm-weekly-api/Dockerfile -t "$IMAGE_URI" .
docker push "$IMAGE_URI"

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --platform managed \
  --ingress all \
  --allow-unauthenticated \
  "${NETWORK_ARGS[@]}" \
  --set-env-vars "^|^WEEKLY_API_PORT=8080|JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED=false|JVM_WEEKLY_STORAGE_BACKEND=${JVM_WEEKLY_STORAGE_BACKEND}|JVM_WEEKLY_PROJECT_ACCESS_BACKEND=${JVM_WEEKLY_PROJECT_ACCESS_BACKEND}|JVM_WEEKLY_DATABASE_URL=${JVM_WEEKLY_DATABASE_URL}|JVM_WEEKLY_DATABASE_USER=${JVM_WEEKLY_DATABASE_USER}|JVM_WEEKLY_FIREBASE_PROJECT_ID=${JVM_WEEKLY_FIRESTORE_PROJECT_ID}|JVM_WEEKLY_FIRESTORE_PROJECT_ID=${JVM_WEEKLY_FIRESTORE_PROJECT_ID}|JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID=${JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID}|JVM_WEEKLY_ALLOWED_ORIGINS=${JVM_WEEKLY_ALLOWED_ORIGINS}" \
  --set-secrets "JVM_WEEKLY_DATABASE_PASSWORD=${JVM_WEEKLY_DATABASE_PASSWORD_SECRET}:latest,JVM_WEEKLY_INTERNAL_API_TOKEN=${JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET}:latest"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
if [[ -z "$JVM_WEEKLY_SMOKE_URL" ]]; then
  JVM_WEEKLY_SMOKE_URL="$SERVICE_URL"
fi
SMOKE_FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY:-$(gcloud secrets versions access latest --secret="$FIREBASE_WEB_API_KEY_SECRET")}"
SMOKE_EMAIL="${JVM_WEEKLY_SMOKE_EMAIL:-$(gcloud secrets versions access latest --secret="$JVM_WEEKLY_SMOKE_EMAIL_SECRET")}"
SMOKE_PASSWORD="${JVM_WEEKLY_SMOKE_PASSWORD:-$(gcloud secrets versions access latest --secret="$JVM_WEEKLY_SMOKE_PASSWORD_SECRET")}"
SMOKE_AUTH_ENV="$(
  FIREBASE_WEB_API_KEY="$SMOKE_FIREBASE_WEB_API_KEY" \
  JVM_WEEKLY_SMOKE_EMAIL="$SMOKE_EMAIL" \
  JVM_WEEKLY_SMOKE_PASSWORD="$SMOKE_PASSWORD" \
    node scripts/create_firebase_smoke_id_token.mjs --env
)"
eval "$SMOKE_AUTH_ENV"
node scripts/smoke_jvm_weekly_api.mjs --require-identity-token --base-url="$JVM_WEEKLY_SMOKE_URL"

echo "[deploy-jvm-weekly-api] done"
