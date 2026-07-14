#!/usr/bin/env bash
set -euo pipefail

STAGE_GCP_PROJECT_ID="inner-platform-qa-20260310"
STAGE_SERVICE_NAME="innerplatform-jvm-weekly-api-lease-stage"
STAGE_REGION="asia-northeast3"
SETTING="JVM_WEEKLY_CASHFLOW_MONTH_CLOSE_QA_DATE"

fail() {
  echo "[cashflow-qa-date] $1" >&2
  exit 1
}

is_valid_date() {
  local value="$1"
  [[ "$value" =~ ^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ ]] || return 1
  local year="${value:0:4}"
  local month="${value:5:2}"
  local day="${value:8:2}"
  local year_number=$((10#$year))
  local month_number=$((10#$month))
  local day_number=$((10#$day))
  local max_day
  case "$month_number" in
    4|6|9|11) max_day=30 ;;
    2)
      if (( year_number % 400 == 0 || (year_number % 4 == 0 && year_number % 100 != 0) )); then
        max_day=29
      else
        max_day=28
      fi
      ;;
    *) max_day=31 ;;
  esac
  (( day_number <= max_day ))
}

VALUE="${1:-}"
[[ -n "$VALUE" ]] || fail "Usage: $0 YYYY-MM-DD|reset"

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}"
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi
[[ "$PROJECT_ID" == "$STAGE_GCP_PROJECT_ID" ]] \
  || fail "Stage-only QA date requires project $STAGE_GCP_PROJECT_ID"

if [[ "$VALUE" == "reset" ]]; then
  gcloud run services update "$STAGE_SERVICE_NAME" \
    --project "$STAGE_GCP_PROJECT_ID" \
    --region "$STAGE_REGION" \
    --remove-env-vars "$SETTING" \
    --quiet
  echo "[cashflow-qa-date] reset to the real Asia/Seoul date"
  exit 0
fi

is_valid_date "$VALUE" || fail "QA date must be a valid YYYY-MM-DD date between 2000-01-01 and 2099-12-31"

gcloud run services update "$STAGE_SERVICE_NAME" \
  --project "$STAGE_GCP_PROJECT_ID" \
  --region "$STAGE_REGION" \
  --update-env-vars "$SETTING=$VALUE" \
  --quiet

echo "[cashflow-qa-date] Stage cashflow month-close date set to $VALUE"
