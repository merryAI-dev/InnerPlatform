#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-"(default)"}"
BACKUP_LOCATION="${FIRESTORE_BACKUP_LOCATION:-asia-northeast3}"
RESTORE_DATABASE_ID="${FIRESTORE_RESTORE_DATABASE_ID:-reh$(date +%y%m%d%H%M)}"
DRY_RUN="${FIRESTORE_REHEARSAL_DRY_RUN:-false}"
DELETE_AFTER_VERIFY="${FIRESTORE_REHEARSAL_DELETE_AFTER_VERIFY:-false}"

if [[ -z "$PROJECT_ID" ]]; then
  printf "[firestore-backup-rehearsal] FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required\n"
  exit 1
fi

latest_backup="${FIRESTORE_SOURCE_BACKUP:-}"
if [[ -z "$latest_backup" ]]; then
  latest_backup="$(gcloud firestore backups list \
    --project "$PROJECT_ID" \
    --location "$BACKUP_LOCATION" \
    --filter="state=READY" \
    --sort-by='~createTime' \
    --format='value(name)' \
    --limit=1)"
fi

if [[ -z "$latest_backup" ]]; then
  printf "[firestore-backup-rehearsal] No READY backup found in location '%s'\n" "$BACKUP_LOCATION"
  exit 2
fi

printf "[firestore-backup-rehearsal] source-backup=%s destination-db=%s\n" "$latest_backup" "$RESTORE_DATABASE_ID"

restore_cmd=(
  gcloud firestore databases restore
  --project "$PROJECT_ID"
  --source-backup "$latest_backup"
  --destination-database "$RESTORE_DATABASE_ID"
  --quiet
)

if [[ "$DRY_RUN" == "true" ]]; then
  printf "[firestore-backup-rehearsal] dry-run command:\n"
  printf "%q " "${restore_cmd[@]}"
  printf "\n"
  exit 0
fi

"${restore_cmd[@]}"

printf "[firestore-backup-rehearsal] Restore requested. Validate data in '%s' database, then optionally delete it.\n" "$RESTORE_DATABASE_ID"

if [[ "$DELETE_AFTER_VERIFY" == "true" ]]; then
  printf "[firestore-backup-rehearsal] Deleting rehearsal database '%s'...\n" "$RESTORE_DATABASE_ID"
  gcloud firestore databases delete \
    --project "$PROJECT_ID" \
    --database "$RESTORE_DATABASE_ID" \
    --quiet
fi
