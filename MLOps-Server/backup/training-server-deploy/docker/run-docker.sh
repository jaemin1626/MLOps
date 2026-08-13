#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/paths.sh"
resolve_training_docker_paths "${BASH_SOURCE[0]}"

TRAIN_IMAGE="${TRAIN_IMAGE:-intellivix-train-agent:1.0.0}"
TRAIN_CONTAINER="${TRAIN_CONTAINER:-intellivix-train-agent}"
AGENT_PORT="${AGENT_PORT:-9010}"
TRAIN_GPU_DEVICE="${TRAIN_GPU_DEVICE:-0}"
TRAIN_SHM_SIZE="${TRAIN_SHM_SIZE:-8g}"
TRAIN_NETWORK_MODE="${TRAIN_NETWORK_MODE:-host}"
TRAIN_AUTO_BUILD="${TRAIN_AUTO_BUILD:-1}"
TRAIN_DETACHED="${TRAIN_DETACHED:-1}"
TRAIN_FOLLOW_LOGS="${TRAIN_FOLLOW_LOGS:-1}"
TRAIN_SHOW_LOGS="${TRAIN_SHOW_LOGS:-1}"

for arg in "$@"; do
  case "${arg}" in
    --follow|-f) TRAIN_FOLLOW_LOGS=1 ;;
    --no-follow) TRAIN_FOLLOW_LOGS=0 ;;
    --foreground|--fg) TRAIN_DETACHED=0; TRAIN_FOLLOW_LOGS=0 ;;
    --no-logs) TRAIN_SHOW_LOGS=0; TRAIN_FOLLOW_LOGS=0 ;;
  esac
done

if [[ "${TRAIN_AUTO_BUILD}" == "1" ]] && ! docker image inspect "${TRAIN_IMAGE}" >/dev/null 2>&1; then
  echo "이미지가 없어 build-image.sh 실행"
  bash "${SCRIPT_DIR}/build-image.sh"
fi

docker rm -f "${TRAIN_CONTAINER}" >/dev/null 2>&1 || true

GPU_ARGS=()
if [[ -n "${TRAIN_GPU_DEVICE}" ]]; then
  GPU_ARGS=(--gpus "device=${TRAIN_GPU_DEVICE}")
else
  echo "경고: TRAIN_GPU_DEVICE 가 비어 있어 GPU 없이 컨테이너를 실행합니다. ONNX export는 CPU fallback으로 동작합니다." >&2
fi

NETWORK_ARGS=()
if [[ "${TRAIN_NETWORK_MODE}" == "host" ]]; then
  NETWORK_ARGS=(--network host)
else
  NETWORK_ARGS=(-p "${AGENT_PORT}:9010")
fi

DATASET_HOST="${WORKSPACE_ROOT}/dataset"
if [[ ! -d "${DATASET_HOST}" ]]; then
  echo "경고: dataset 폴더가 없어 생성합니다: ${DATASET_HOST}" >&2
  mkdir -p "${DATASET_HOST}"
fi

RUN_ARGS=(
  --name "${TRAIN_CONTAINER}"
  "${GPU_ARGS[@]}"
  "${NETWORK_ARGS[@]}"
  --shm-size "${TRAIN_SHM_SIZE}"
  -e TZ="${TZ:-Asia/Seoul}"
  -e USE_CONDA=0
  -e WORKSPACE_ROOT=/workspace
  -e AGENT_HOST=0.0.0.0
  -e AGENT_PORT=9010
  -e AUTH_TOKEN="${AUTH_TOKEN:-}"
  -v "${WORKSPACE_ROOT}:/workspace"
  -v "${DATASET_HOST}:/workspace/dataset:rw"
)

echo "Training agent container start"
echo "  container : ${TRAIN_CONTAINER}"
echo "  image     : ${TRAIN_IMAGE}"
echo "  workspace : ${WORKSPACE_ROOT} -> /workspace"
echo "  dataset   : ${DATASET_HOST} -> /workspace/dataset"
echo "  port      : ${AGENT_PORT}"
echo "  gpu       : ${TRAIN_GPU_DEVICE:-none}"
echo "  shm-size  : ${TRAIN_SHM_SIZE}"
echo "  mode      : $([[ "${TRAIN_DETACHED}" == "1" ]] && echo detached || echo foreground)"
echo "  logs      : $([[ "${TRAIN_FOLLOW_LOGS}" == "1" ]] && echo follow || echo snapshot)"

if [[ "${TRAIN_DETACHED}" == "1" ]]; then
  docker run -d \
    "${RUN_ARGS[@]}" \
    --restart unless-stopped \
    "${TRAIN_IMAGE}"

  sleep 2

  if [[ "${TRAIN_FOLLOW_LOGS}" == "1" ]]; then
    echo
    echo "=== 실시간 agent 로그 (REST 대기 / 명령 접수 / 수행, Ctrl+C 종료) ==="
    echo "    컨테이너는 계속 실행됩니다."
    echo "    health: http://127.0.0.1:${AGENT_PORT}/api/v1/health"
    echo
    docker logs -f "${TRAIN_CONTAINER}"
  else
    bash "${SCRIPT_DIR}/status-docker.sh"
    if [[ "${TRAIN_SHOW_LOGS}" == "1" ]]; then
      echo
      echo "실시간 로그: bash ${SCRIPT_DIR}/logs-docker.sh"
    fi
  fi
else
  echo
  echo "=== foreground mode ==="
  echo "아래 터미널에 REST 대기/명령 수신/수행 로그가 실시간 표시됩니다."
  echo "종료: Ctrl+C"
  echo
  docker run --rm \
    "${RUN_ARGS[@]}" \
    "${TRAIN_IMAGE}"
fi
