#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/docker/load-mlops-connection.sh"

MLOPS_IMAGE="${MLOPS_IMAGE:-intellivix-mlops:1.1.1}"
MLOPS_CONTAINER_NAME="${MLOPS_CONTAINER_NAME:-intellivix-mlops}"
MLOPS_UID="${MLOPS_UID:-$(id -u)}"
MLOPS_GID="${MLOPS_GID:-$(id -g)}"
MLOPS_FORCE_SYNC="${MLOPS_FORCE_SYNC:-0}"

resolve_path() {
  local path="$1"
  if [[ "$path" != /* ]]; then
    path="${SCRIPT_DIR}/${path}"
  fi
  mkdir -p "$path" 2>/dev/null || true
  (cd "$path" && pwd)
}

ensure_data_root_writable() {
  local data_root="$1"
  local parent
  local uid="${MLOPS_UID:-$(id -u)}"
  local gid="${MLOPS_GID:-$(id -g)}"

  parent="$(dirname "${data_root}")"
  mkdir -p "${parent}" "${data_root}" 2>/dev/null || true

  if [[ -w "${data_root}" && -O "${data_root}" ]]; then
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "오류: ${data_root}에 쓸 수 없습니다. 관리자에게 chown ${uid}:${gid} ${parent} 요청하세요." >&2
    exit 1
  fi

  echo "데이터 경로 권한 수정 중: ${parent} -> ${uid}:${gid}"
  docker run --rm \
    -v "${parent}:/parent" \
    alpine:3.20 \
    sh -c "mkdir -p /parent/$(basename "${data_root}") && chown -R ${uid}:${gid} /parent && chmod -R u+rwX /parent"
}

MLOPS_WORKSPACE_PATH="$(resolve_path "$MLOPS_WORKSPACE_PATH")"
MLOPS_DATA_ROOT="$(resolve_path "$MLOPS_DATA_ROOT")"
ensure_data_root_writable "${MLOPS_DATA_ROOT}"

sync_host_dataset_if_needed() {
  if [[ -z "${MLOPS_SSH_PASSWORD:-}" || "${MLOPS_SYNC_ON_START}" == "0" ]]; then
    return 0
  fi
  echo "호스트에서 학습 서버 dataset 증분 동기화: ${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}"
  MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT}" bash "${SCRIPT_DIR}/docker/sync-training-dataset.sh"
}

list_remote_weights_if_needed() {
  if [[ -z "${MLOPS_SSH_PASSWORD:-}" || "${MLOPS_SYNC_ON_START}" == "0" ]]; then
    return 0
  fi
  echo "호스트에서 학습 서버 weights 목록 조회: ${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}"
  MLOPS_DATA_ROOT="${MLOPS_DATA_ROOT}" bash "${SCRIPT_DIR}/docker/list-remote-weights.sh" || true
}

start_dataset_sync_watchdog() {
  if [[ -z "${MLOPS_SSH_PASSWORD:-}" || "${MLOPS_SYNC_ON_START}" == "0" ]]; then
    return 0
  fi

  local pid_file="${MLOPS_DATA_ROOT}/.mlops-sync-watchdog.pid"
  if [[ -f "${pid_file}" ]]; then
    local old_pid=""
    old_pid="$(tr -d '[:space:]' < "${pid_file}")"
    if [[ -n "${old_pid}" ]] && kill -0 "${old_pid}" 2>/dev/null; then
      kill "${old_pid}" 2>/dev/null || true
      wait "${old_pid}" 2>/dev/null || true
    fi
    rm -f "${pid_file}"
  fi

  echo "학습 서버 dataset 동기화 watchdog 시작"
  bash "${SCRIPT_DIR}/docker/sync-watchdog.sh" &
  MLOPS_SYNC_WATCHDOG_PID=$!
  echo "${MLOPS_SYNC_WATCHDOG_PID}" > "${pid_file}"
  trap 'kill "${MLOPS_SYNC_WATCHDOG_PID}" 2>/dev/null || true; rm -f "${pid_file}"' EXIT
}

sync_host_dataset_if_needed
list_remote_weights_if_needed
start_dataset_sync_watchdog

mkdir -p \
  "${MLOPS_WORKSPACE_PATH}/jobs/running" \
  "${MLOPS_WORKSPACE_PATH}/jobs/completed" \
  "${MLOPS_WORKSPACE_PATH}/jobs/failed" \
  "${MLOPS_WORKSPACE_PATH}/models" \
  "${MLOPS_WORKSPACE_PATH}/exports" \
  "${MLOPS_WORKSPACE_PATH}/logs"

if ! command -v docker >/dev/null 2>&1; then
  echo "오류: docker 명령을 찾을 수 없습니다." >&2
  exit 1
fi

if ! docker image inspect "${MLOPS_IMAGE}" >/dev/null 2>&1 || [[ "${MLOPS_FORCE_REBUILD:-0}" == "1" ]]; then
  echo "이미지 ${MLOPS_IMAGE} 빌드 중..."
  docker build -t "${MLOPS_IMAGE}" "${SCRIPT_DIR}"
fi

if docker ps -a --format '{{.Names}}' | grep -qx "${MLOPS_CONTAINER_NAME}"; then
  echo "기존 컨테이너 ${MLOPS_CONTAINER_NAME} 중지 및 제거 중..."
  docker rm -f "${MLOPS_CONTAINER_NAME}" >/dev/null
fi

GPU_ARGS=()
if [[ -n "${MLOPS_GPU_DEVICE:-}" ]]; then
  GPU_ARGS=(--gpus "device=${MLOPS_GPU_DEVICE}")
fi

if [[ -z "${MLOPS_SSH_PASSWORD:-}" ]]; then
  echo "경고: ssh.password 가 비어 있습니다. config/mlops-connection.json 을 확인하세요." >&2
fi

echo "Intellivix MLOps 실행: http://localhost:${MLOPS_HOST_PORT}"
echo "배포 설정 (이 파일만 수정): ${MLOPS_CONNECTION_FILE}"
echo "학습 서버 agent: ${MLOPS_TRAINING_SERVER_URL}"
echo "workspace (MLOps jobs): ${MLOPS_WORKSPACE_PATH} -> /app/workspace"
echo "dataset (Intellivix_MLops_train_server):   ${MLOPS_DATA_ROOT} -> /workspace/dataset"
echo "학습 서버 workspace:    /workspace (= remoteWorkspaceRoot on training server)"
echo "종료: Ctrl+C"

exec docker run --rm \
  --name "${MLOPS_CONTAINER_NAME}" \
  --network host \
  --pid=host \
  --ipc=host \
  "${GPU_ARGS[@]}" \
  -e NODE_ENV=production \
  -e TZ="${TZ}" \
  -e PORT="${MLOPS_HOST_PORT}" \
  -e MLOPS_RUNTIME_PROFILE=docker \
  -e MLOPS_CONNECTION_FILE=/app/config/mlops-connection.json \
  -e MLOPS_DATASET_SYNC_ENABLED="${MLOPS_SYNC_ON_START:-1}" \
  -e TRAINING_WORKSPACE_ROOT=/workspace \
  -e MLOPS_SSH_HOST="${MLOPS_SSH_HOST}" \
  -e MLOPS_SSH_USER="${MLOPS_SSH_USER}" \
  -e MLOPS_SSH_PASSWORD="${MLOPS_SSH_PASSWORD:-}" \
  -e MLOPS_SSH_REMOTE_WORKSPACE_ROOT="${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}" \
  -e MLOPS_RUNTIME_UID="${MLOPS_UID}" \
  -e MLOPS_RUNTIME_GID="${MLOPS_GID}" \
  ${MLOPS_GPU_DEVICE:+-e "NVIDIA_VISIBLE_DEVICES=${MLOPS_GPU_DEVICE}"} \
  -v "${SCRIPT_DIR}/config:/app/config:ro" \
  -v "${SCRIPT_DIR}/server:/app/server:ro" \
  -v "${SCRIPT_DIR}/public:/app/public:ro" \
  -v "${SCRIPT_DIR}/docker:/app/docker:ro" \
  -v "${MLOPS_WORKSPACE_PATH}:/app/workspace" \
  -v "${MLOPS_DATA_ROOT}:/workspace/dataset:rw" \
  --add-host host.docker.internal:host-gateway \
  -w /app \
  "${MLOPS_IMAGE}"
