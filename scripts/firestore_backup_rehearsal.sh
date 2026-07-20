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

if [[ "$RESTORE_DATABASE_ID" == "(default)" || "$RESTORE_DATABASE_ID" == "$DATABASE_ID" ]]; then
  printf "[firestore-backup-rehearsal] FIRESTORE_RESTORE_DATABASE_ID must be a new non-default database (source=%s destination=%s)\n" "$DATABASE_ID" "$RESTORE_DATABASE_ID"
  exit 1
fi

if [[ "$DELETE_AFTER_VERIFY" == "true" ]]; then
  printf "[firestore-backup-rehearsal] Automatic deletion is disabled. Validate first, then delete the rehearsal database with an explicit gcloud command.\n"
  exit 1
fi

latest_backup="${FIRESTORE_SOURCE_BACKUP:-}"
if [[ -z "$latest_backup" ]]; then
  printf "[firestore-backup-rehearsal] FIRESTORE_SOURCE_BACKUP is required to verify the source database before restore.\n"
  printf "[firestore-backup-rehearsal] List READY backups with: gcloud firestore backups list --project %q --location %q --filter='state=READY' --format='table(name,database,state,createTime)'\n" "$PROJECT_ID" "$BACKUP_LOCATION"
  exit 2
fi

printf "[firestore-backup-rehearsal] source-db=%s source-backup=%s destination-db=%s\n" "$DATABASE_ID" "$latest_backup" "$RESTORE_DATABASE_ID"

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
printf "[firestore-backup-rehearsal] After validation, delete explicitly if needed: gcloud firestore databases delete --project %q --database %q --quiet\n" "$PROJECT_ID" "$RESTORE_DATABASE_ID"
