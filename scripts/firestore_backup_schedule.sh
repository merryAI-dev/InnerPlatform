#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-"(default)"}"
RETENTION="${FIRESTORE_BACKUP_RETENTION:-14d}"
RECURRENCE="${FIRESTORE_BACKUP_RECURRENCE:-daily}"
DAY_OF_WEEK="${FIRESTORE_BACKUP_DAY_OF_WEEK:-MON}"

if [[ -z "$PROJECT_ID" ]]; then
  printf "[firestore-backup-schedule] FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required\n"
  exit 1
fi

if [[ "$RECURRENCE" != "daily" && "$RECURRENCE" != "weekly" ]]; then
  printf "[firestore-backup-schedule] FIRESTORE_BACKUP_RECURRENCE must be 'daily' or 'weekly'\n"
  exit 1
fi

existing_schedule="$(gcloud firestore backups schedules list \
  --project "$PROJECT_ID" \
  --database "$DATABASE_ID" \
  --format='value(name)' \
  --limit=1 2>/dev/null || true)"

if [[ -z "$existing_schedule" ]]; then
  printf "[firestore-backup-schedule] Creating backup schedule (database=%s recurrence=%s retention=%s)\n" "$DATABASE_ID" "$RECURRENCE" "$RETENTION"
  if [[ "$RECURRENCE" == "weekly" ]]; then
    gcloud firestore backups schedules create \
      --project "$PROJECT_ID" \
      --database "$DATABASE_ID" \
      --retention "$RETENTION" \
      --recurrence weekly \
      --day-of-week "$DAY_OF_WEEK" \
      --quiet
  else
    gcloud firestore backups schedules create \
      --project "$PROJECT_ID" \
      --database "$DATABASE_ID" \
      --retention "$RETENTION" \
      --recurrence daily \
      --quiet
  fi
else
  printf "[firestore-backup-schedule] Updating retention on existing schedule: %s\n" "$existing_schedule"
  gcloud firestore backups schedules update \
    --project "$PROJECT_ID" \
    --database "$DATABASE_ID" \
    --backup-schedule "$existing_schedule" \
    --retention "$RETENTION" \
    --quiet
fi

printf "[firestore-backup-schedule] Current schedules:\n"
gcloud firestore backups schedules list \
  --project "$PROJECT_ID" \
  --database "$DATABASE_ID" \
  --format='table(name,retention,recurrence,dailyRecurrence,weeklyRecurrence.day)'
