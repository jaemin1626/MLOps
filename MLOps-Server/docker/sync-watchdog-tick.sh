#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${PROJECT_ROOT}/docker/load-mlops-connection.sh"

MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT:-${PROJECT_ROOT}/cache/training-dataset}"
if [[ "$MLOPS_DATA_ROOT" != /* ]]; then
  MLOPS_DATA_ROOT="${PROJECT_ROOT}/${MLOPS_DATA_ROOT}"
fi

REQUEST_FILE="${MLOPS_DATA_ROOT}/.mlops-sync-request"
STATUS_FILE="${MLOPS_DATA_ROOT}/.mlops-sync-status"
LOG_FILE="${MLOPS_DATA_ROOT}/.mlops-sync.log"
WEIGHTS_REQUEST_FILE="${MLOPS_DATA_ROOT}/.mlops-weights-list-request"
WEIGHTS_LOG_FILE="${MLOPS_DATA_ROOT}/.mlops-weights-list.log"
ONNX_REQUEST_DIR="${MLOPS_DATA_ROOT}/.mlops-onnx-fetch-requests"
ONNX_LOG_FILE="${MLOPS_DATA_ROOT}/.mlops-onnx-fetch.log"

write_status() {
  local state="$1"
  local request_id="$2"
  local message="${3:-}"
  local updated_at
  updated_at="$(date -Iseconds)"
  printf '{"state":"%s","requestId":"%s","updatedAt":"%s","message":"%s"}\n' \
    "${state}" "${request_id}" "${updated_at}" "${message//\"/\\\"}" > "${STATUS_FILE}"
}

if [[ -f "${REQUEST_FILE}" ]]; then
  request_id="$(tr -d '\n' < "${REQUEST_FILE}")"
  rm -f "${REQUEST_FILE}"
  write_status "running" "${request_id}" "sync in progress"
  {
    echo "[$(date -Iseconds)] sync request ${request_id}"
    if MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT}" bash "${SCRIPT_DIR}/sync-training-dataset.sh"; then
      write_status "ok" "${request_id}" "sync completed"
      echo "[$(date -Iseconds)] sync completed ${request_id}"
    else
      write_status "error" "${request_id}" "sync failed"
      echo "[$(date -Iseconds)] sync failed ${request_id}"
    fi
  } >> "${LOG_FILE}" 2>&1
fi

if [[ -f "${WEIGHTS_REQUEST_FILE}" ]]; then
  request_id="$(tr -d '\n' < "${WEIGHTS_REQUEST_FILE}")"
  rm -f "${WEIGHTS_REQUEST_FILE}"
  {
    echo "[$(date -Iseconds)] weights list request ${request_id}"
    if MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT}" bash "${SCRIPT_DIR}/list-remote-weights.sh"; then
      echo "[$(date -Iseconds)] weights list completed ${request_id}"
    else
      echo "[$(date -Iseconds)] weights list failed ${request_id}"
    fi
  } >> "${WEIGHTS_LOG_FILE}" 2>&1
fi

if [[ -d "${ONNX_REQUEST_DIR}" ]]; then
  shopt -s nullglob
  for request_file in "${ONNX_REQUEST_DIR}"/*.json; do
    [[ -f "${request_file}" ]] || continue
    [[ "${request_file}" == *.status.json ]] && continue
    request_id="$(basename "${request_file}" .json)"
    status_file="${ONNX_REQUEST_DIR}/${request_id}.status.json"
    [[ -f "${status_file}" ]] && continue
    relative_path="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['relativePath'])" "${request_file}")"
    cache_file="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['cacheFile'])" "${request_file}")"
    {
      echo "[$(date -Iseconds)] onnx fetch request ${request_id} path=${relative_path}"
      if MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT}" bash "${SCRIPT_DIR}/fetch-remote-workspace-file.sh" "${relative_path}" "${cache_file}"; then
        python3 -c "import json,sys; json.dump({'state':'ok','requestId':sys.argv[1],'message':'fetch completed'}, open(sys.argv[2],'w'), ensure_ascii=False); print()" "${request_id}" "${status_file}"
        echo "[$(date -Iseconds)] onnx fetch completed ${request_id}"
      else
        python3 -c "import json,sys; json.dump({'state':'error','requestId':sys.argv[1],'message':'fetch failed'}, open(sys.argv[2],'w'), ensure_ascii=False); print()" "${request_id}" "${status_file}"
        echo "[$(date -Iseconds)] onnx fetch failed ${request_id}"
      fi
    } >> "${ONNX_LOG_FILE}" 2>&1
  done
  shopt -u nullglob
fi
