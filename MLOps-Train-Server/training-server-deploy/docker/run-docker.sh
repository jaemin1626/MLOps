#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/paths.sh"
resolve_training_docker_paths "${BASH_SOURCE[0]}"

DETECTOR_IMAGE="${DETECTOR_IMAGE:-detector-agent:1.0.0}"
DETECTOR_CONTAINER="${DETECTOR_CONTAINER:-detector-agent}"
AGENT_PORT="${AGENT_PORT:-9010}"
DETECTOR_GPU_DEVICE="${DETECTOR_GPU_DEVICE:-0}"
DETECTOR_SHM_SIZE="${DETECTOR_SHM_SIZE:-8g}"
DETECTOR_NETWORK_MODE="${DETECTOR_NETWORK_MODE:-host}"
DETECTOR_AUTO_BUILD="${DETECTOR_AUTO_BUILD:-1}"
DETECTOR_DETACHED="${DETECTOR_DETACHED:-1}"
DETECTOR_FOLLOW_LOGS="${DETECTOR_FOLLOW_LOGS:-1}"
DETECTOR_SHOW_LOGS="${DETECTOR_SHOW_LOGS:-1}"

for arg in "$@"; do
  case "${arg}" in
    --follow|-f) DETECTOR_FOLLOW_LOGS=1 ;;
    --no-follow) DETECTOR_FOLLOW_LOGS=0 ;;
    --foreground|--fg) DETECTOR_DETACHED=0; DETECTOR_FOLLOW_LOGS=0 ;;
    --no-logs) DETECTOR_SHOW_LOGS=0; DETECTOR_FOLLOW_LOGS=0 ;;
  esac
done

if [[ "${DETECTOR_AUTO_BUILD}" == "1" ]] && ! docker image inspect "${DETECTOR_IMAGE}" >/dev/null 2>&1; then
  echo "이미지가 없어 build-image.sh 실행"
  bash "${SCRIPT_DIR}/build-image.sh"
fi

docker rm -f "${DETECTOR_CONTAINER}" >/dev/null 2>&1 || true

GPU_ARGS=()
if [[ -n "${DETECTOR_GPU_DEVICE}" ]]; then
  GPU_ARGS=(--gpus "device=${DETECTOR_GPU_DEVICE}")
else
  echo "경고: DETECTOR_GPU_DEVICE 가 비어 있어 GPU 없이 컨테이너를 실행합니다. ONNX export는 CPU fallback으로 동작합니다." >&2
fi

NETWORK_ARGS=()
if [[ "${DETECTOR_NETWORK_MODE}" == "host" ]]; then
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
  --name "${DETECTOR_CONTAINER}"
  "${GPU_ARGS[@]}"
  "${NETWORK_ARGS[@]}"
  --shm-size "${DETECTOR_SHM_SIZE}"
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
echo "  container : ${DETECTOR_CONTAINER}"
echo "  image     : ${DETECTOR_IMAGE}"
echo "  workspace : ${WORKSPACE_ROOT} -> /workspace"
echo "  dataset   : ${DATASET_HOST} -> /workspace/dataset"
echo "  port      : ${AGENT_PORT}"
echo "  gpu       : ${DETECTOR_GPU_DEVICE:-none}"
echo "  shm-size  : ${DETECTOR_SHM_SIZE}"
echo "  mode      : $([[ "${DETECTOR_DETACHED}" == "1" ]] && echo detached || echo foreground)"
echo "  logs      : $([[ "${DETECTOR_FOLLOW_LOGS}" == "1" ]] && echo follow || echo snapshot)"

if [[ "${DETECTOR_DETACHED}" == "1" ]]; then
  docker run -d \
    "${RUN_ARGS[@]}" \
    --restart unless-stopped \
    "${DETECTOR_IMAGE}"

  sleep 2

  if [[ "${DETECTOR_FOLLOW_LOGS}" == "1" ]]; then
    echo
    echo "=== 실시간 agent 로그 (REST 대기 / 명령 접수 / 수행, Ctrl+C 종료) ==="
    echo "    컨테이너는 계속 실행됩니다."
    echo "    health: http://127.0.0.1:${AGENT_PORT}/api/v1/health"
    echo
    docker logs -f "${DETECTOR_CONTAINER}"
  else
    bash "${SCRIPT_DIR}/status-docker.sh"
    if [[ "${DETECTOR_SHOW_LOGS}" == "1" ]]; then
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
    "${DETECTOR_IMAGE}"
fi
