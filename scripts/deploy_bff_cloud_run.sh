#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REGION="${REGION:-asia-northeast3}"
SERVICE_NAME="${SERVICE_NAME:-mysc-bff}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"
PROJECT_ID="${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
BFF_ALLOWED_ORIGINS="${BFF_ALLOWED_ORIGINS:-*}"
BFF_OUTBOX_BATCH="${BFF_OUTBOX_BATCH:-50}"
BFF_OUTBOX_MAX_ATTEMPTS="${BFF_OUTBOX_MAX_ATTEMPTS:-8}"
PII_MODE="${PII_MODE:-off}"
PII_KMS_KEYS="${PII_KMS_KEYS:-}"
PII_KMS_CURRENT_KEY="${PII_KMS_CURRENT_KEY:-}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "[deploy-bff] FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required"
  exit 1
fi

IMAGE_URI="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "[deploy-bff] project=${PROJECT_ID} region=${REGION} service=${SERVICE_NAME} image=${IMAGE_URI}"

docker build -f server/bff/Dockerfile -t "$IMAGE_URI" .
docker push "$IMAGE_URI"

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT_ID},BFF_ALLOWED_ORIGINS=${BFF_ALLOWED_ORIGINS},BFF_OUTBOX_BATCH=${BFF_OUTBOX_BATCH},BFF_OUTBOX_MAX_ATTEMPTS=${BFF_OUTBOX_MAX_ATTEMPTS},PII_MODE=${PII_MODE},PII_KMS_KEYS=${PII_KMS_KEYS},PII_KMS_CURRENT_KEY=${PII_KMS_CURRENT_KEY}"

echo "[deploy-bff] done"
