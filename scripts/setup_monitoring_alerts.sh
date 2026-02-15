#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
SERVICE_NAME="${BFF_SERVICE_NAME:-mysc-bff}"
NOTIFICATION_CHANNELS="${MONITORING_NOTIFICATION_CHANNELS:-}"
TMP_DIR="${ROOT_DIR}/tmp/monitoring"
mkdir -p "$TMP_DIR"

if [[ -z "$PROJECT_ID" ]]; then
  printf "[monitoring-setup] FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required\n"
  exit 1
fi

to_json_array() {
  local csv="$1"
  local arr=()
  IFS=',' read -r -a arr <<< "$csv"
  local out="["
  local first=true
  for raw in "${arr[@]}"; do
    local value
    value="$(echo "$raw" | xargs)"
    [[ -z "$value" ]] && continue
    if [[ "$first" == true ]]; then
      first=false
    else
      out+=", "
    fi
    out+="\"${value}\""
  done
  out+="]"
  printf "%s" "$out"
}

CHANNELS_JSON="$(to_json_array "$NOTIFICATION_CHANNELS")"

version_conflict_filter="resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${SERVICE_NAME}\" jsonPayload.errorCode=\"version_conflict\""
if gcloud logging metrics describe bff_version_conflicts_count --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud logging metrics update bff_version_conflicts_count \
    --project "$PROJECT_ID" \
    --description="Count of version_conflict responses from ${SERVICE_NAME}" \
    --log-filter="$version_conflict_filter"
else
  gcloud logging metrics create bff_version_conflicts_count \
    --project "$PROJECT_ID" \
    --description="Count of version_conflict responses from ${SERVICE_NAME}" \
    --log-filter="$version_conflict_filter"
fi

cat > "${TMP_DIR}/bff-5xx-rate.json" <<EOF
{
  "displayName": "${SERVICE_NAME} 5xx rate > 1%",
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ${CHANNELS_JSON},
  "documentation": {
    "content": "Cloud Run 5xx ratio exceeded 1% for 5 minutes.",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "5xx ratio > 1% (5m)",
      "conditionThreshold": {
        "filter": "metric.type=\\"run.googleapis.com/request_count\\" resource.type=\\"cloud_run_revision\\" resource.label.\\"service_name\\"=\\"${SERVICE_NAME}\\" metric.label.\\"response_code_class\\"=\\"5xx\\"",
        "denominatorFilter": "metric.type=\\"run.googleapis.com/request_count\\" resource.type=\\"cloud_run_revision\\" resource.label.\\"service_name\\"=\\"${SERVICE_NAME}\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.01,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE"
          }
        ],
        "denominatorAggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE"
          }
        ],
        "trigger": {
          "count": 1
        }
      }
    }
  ]
}
EOF

cat > "${TMP_DIR}/bff-latency-p95.json" <<EOF
{
  "displayName": "${SERVICE_NAME} P95 latency > 2s",
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ${CHANNELS_JSON},
  "documentation": {
    "content": "Cloud Run request latency p95 exceeded 2s for 5 minutes.",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "p95 latency > 2s (5m)",
      "conditionThreshold": {
        "filter": "metric.type=\\"run.googleapis.com/request_latencies\\" resource.type=\\"cloud_run_revision\\" resource.label.\\"service_name\\"=\\"${SERVICE_NAME}\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 2,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_PERCENTILE_95"
          }
        ],
        "trigger": {
          "count": 1
        }
      }
    }
  ]
}
EOF

cat > "${TMP_DIR}/bff-version-conflict-rate.json" <<EOF
{
  "displayName": "${SERVICE_NAME} version-conflict rate > 5%",
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ${CHANNELS_JSON},
  "documentation": {
    "content": "Version conflict ratio exceeded 5% for 10 minutes. Check optimistic concurrency hot-spots.",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "version_conflict ratio > 5% (10m)",
      "conditionThreshold": {
        "filter": "metric.type=\\"logging.googleapis.com/user/bff_version_conflicts_count\\" resource.type=\\"cloud_run_revision\\" resource.label.\\"service_name\\"=\\"${SERVICE_NAME}\\"",
        "denominatorFilter": "metric.type=\\"run.googleapis.com/request_count\\" resource.type=\\"cloud_run_revision\\" resource.label.\\"service_name\\"=\\"${SERVICE_NAME}\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.05,
        "duration": "600s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE"
          }
        ],
        "denominatorAggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE"
          }
        ],
        "trigger": {
          "count": 1
        }
      }
    }
  ]
}
EOF

apply_policy() {
  local file="$1"
  local display_name="$2"
  local existing
  existing="$(gcloud monitoring policies list --project "$PROJECT_ID" --filter="displayName=\"${display_name}\"" --format='value(name)' --limit=1)"
  if [[ -n "$existing" ]]; then
    gcloud monitoring policies update "$existing" --project "$PROJECT_ID" --policy-from-file "$file" >/dev/null
    printf "[monitoring-setup] updated: %s\n" "$display_name"
  else
    gcloud monitoring policies create --project "$PROJECT_ID" --policy-from-file "$file" >/dev/null
    printf "[monitoring-setup] created: %s\n" "$display_name"
  fi
}

apply_policy "${TMP_DIR}/bff-5xx-rate.json" "${SERVICE_NAME} 5xx rate > 1%"
apply_policy "${TMP_DIR}/bff-latency-p95.json" "${SERVICE_NAME} P95 latency > 2s"
apply_policy "${TMP_DIR}/bff-version-conflict-rate.json" "${SERVICE_NAME} version-conflict rate > 5%"

printf "[monitoring-setup] done (project=%s service=%s)\n" "$PROJECT_ID" "$SERVICE_NAME"
