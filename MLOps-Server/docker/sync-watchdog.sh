#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${PROJECT_ROOT}/docker/load-mlops-connection.sh"

MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT:-${PROJECT_ROOT}/cache/ailab2-dataset}"
if [[ "$MLOPS_DATA_ROOT" != /* ]]; then
  MLOPS_DATA_ROOT="${PROJECT_ROOT}/${MLOPS_DATA_ROOT}"
fi

STATUS_FILE="${MLOPS_DATA_ROOT}/.mlops-sync-status"

write_status() {
  local state="$1"
  local request_id="$2"
  local message="${3:-}"
  local updated_at
  updated_at="$(date -Iseconds)"
  printf '{"state":"%s","requestId":"%s","updatedAt":"%s","message":"%s"}\n' \
    "${state}" "${request_id}" "${updated_at}" "${message//\"/\\\"}" > "${STATUS_FILE}"
}

mkdir -p "${MLOPS_DATA_ROOT}"
write_status "idle" "" "watchdog ready"

while true; do
  MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT}" bash "${SCRIPT_DIR}/sync-watchdog-tick.sh" || true
  sleep 0.2
done
