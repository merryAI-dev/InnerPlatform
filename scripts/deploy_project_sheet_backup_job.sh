#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
REGION="${REGION:-asia-northeast3}"
JOB_NAME="${BACKUP_JOB_NAME:-innerplatform-project-sheet-backup}"
SCHEDULER_NAME="${BACKUP_SCHEDULER_NAME:-innerplatform-project-sheet-backup-weekly}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"
IMAGE_PLATFORM="${BACKUP_IMAGE_PLATFORM:-linux/amd64}"
BUILD_MODE="${BACKUP_BUILD_MODE:-cloudbuild}"
BUILD_REGION="${BACKUP_BUILD_REGION:-global}"
TENANT_ID="${BACKUP_TENANT_ID:-mysc}"
GCS_BUCKET="${BACKUP_GCS_BUCKET:-}"
GCS_PREFIX="${BACKUP_GCS_PREFIX:-inner-platform/firestore-project-sheets}"
OUT_DIR="${BACKUP_OUT_DIR:-/tmp/innerplatform-project-sheet-backups}"
DRIVE_FOLDER_ID="${BACKUP_DRIVE_FOLDER_ID:-}"
DRIVE_REQUIRED="${BACKUP_DRIVE_REQUIRED:-false}"
SERVICE_ACCOUNT="${BACKUP_SERVICE_ACCOUNT:-}"
SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * 1}"
TIME_ZONE="${BACKUP_TIME_ZONE:-Asia/Seoul}"
TASK_TIMEOUT="${BACKUP_TASK_TIMEOUT:-3600s}"
SLACK_SECRET_NAME="${BACKUP_SLACK_SECRET_NAME:-}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "[backup-job-deploy] FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required"
  exit 1
fi

if [[ -z "$GCS_BUCKET" ]]; then
  echo "[backup-job-deploy] BACKUP_GCS_BUCKET is required"
  exit 1
fi

if [[ -z "$SERVICE_ACCOUNT" ]]; then
  SERVICE_ACCOUNT="innerplatform-backup@${PROJECT_ID}.iam.gserviceaccount.com"
fi

IMAGE_URI="gcr.io/${PROJECT_ID}/${JOB_NAME}:${IMAGE_TAG}"
RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"

echo "[backup-job-deploy] project=${PROJECT_ID} region=${REGION} job=${JOB_NAME} image=${IMAGE_URI}"
echo "[backup-job-deploy] image-platform=${IMAGE_PLATFORM}"
echo "[backup-job-deploy] build-mode=${BUILD_MODE}"
echo "[backup-job-deploy] service-account=${SERVICE_ACCOUNT}"
echo "[backup-job-deploy] schedule='${SCHEDULE}' timezone=${TIME_ZONE}"
if [[ -z "$DRIVE_FOLDER_ID" ]]; then
  echo "[backup-job-deploy] drive-review-copy=disabled"
else
  echo "[backup-job-deploy] drive-review-copy=enabled required=${DRIVE_REQUIRED}"
fi

if [[ "$BUILD_MODE" == "local" ]]; then
  docker buildx build --platform "$IMAGE_PLATFORM" -f scripts/Dockerfile.project-sheet-backup -t "$IMAGE_URI" --push .
else
  CLOUDBUILD_CONFIG="$(mktemp "${TMPDIR:-/tmp}/innerplatform-project-sheet-backup-cloudbuild.XXXXXX.yaml")"
  trap 'rm -f "$CLOUDBUILD_CONFIG"' EXIT
  cat > "$CLOUDBUILD_CONFIG" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --platform
      - ${IMAGE_PLATFORM}
      - -f
      - scripts/Dockerfile.project-sheet-backup
      - -t
      - ${IMAGE_URI}
      - .
images:
  - ${IMAGE_URI}
EOF
  gcloud builds submit . --config "$CLOUDBUILD_CONFIG" --project "$PROJECT_ID" --region "$BUILD_REGION"
fi

ENV_VARS="FIREBASE_PROJECT_ID=${PROJECT_ID},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},BACKUP_TENANT_ID=${TENANT_ID},BACKUP_GCS_BUCKET=${GCS_BUCKET},BACKUP_GCS_PREFIX=${GCS_PREFIX},BACKUP_OUT_DIR=${OUT_DIR},BACKUP_DRIVE_FOLDER_ID=${DRIVE_FOLDER_ID},BACKUP_DRIVE_REQUIRED=${DRIVE_REQUIRED}"

SECRET_FLAGS=()
if [[ -n "$SLACK_SECRET_NAME" ]]; then
  SECRET_FLAGS+=(--set-secrets "BACKUP_SLACK_WEBHOOK_URL=${SLACK_SECRET_NAME}:latest")
fi

DEPLOY_FLAGS=(
  --image "$IMAGE_URI"
  --region "$REGION"
  --tasks 1
  --max-retries 1
  --task-timeout "$TASK_TIMEOUT"
  --service-account "$SERVICE_ACCOUNT"
  --set-env-vars "$ENV_VARS"
)
if [[ ${#SECRET_FLAGS[@]} -gt 0 ]]; then
  DEPLOY_FLAGS+=("${SECRET_FLAGS[@]}")
fi

gcloud run jobs deploy "$JOB_NAME" \
  "${DEPLOY_FLAGS[@]}"

if gcloud scheduler jobs describe "$SCHEDULER_NAME" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHEDULER_NAME" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TIME_ZONE" \
    --uri "$RUN_URI" \
    --http-method POST \
    --oauth-service-account-email "$SERVICE_ACCOUNT"
else
  gcloud scheduler jobs create http "$SCHEDULER_NAME" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TIME_ZONE" \
    --uri "$RUN_URI" \
    --http-method POST \
    --oauth-service-account-email "$SERVICE_ACCOUNT"
fi

echo "[backup-job-deploy] done"
echo "[backup-job-deploy] manual run: gcloud run jobs execute ${JOB_NAME} --region ${REGION} --wait"
