#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/paths.sh"
resolve_vlm_docker_paths "${BASH_SOURCE[0]}"

VLM_IMAGE="${VLM_IMAGE:-intellivix-vlm-agent:1.0.0}"
VLM_CONTAINER="${VLM_CONTAINER:-intellivix-vlm-agent}"
AGENT_PORT="${AGENT_PORT:-9011}"
VLM_GPU_DEVICE="${VLM_GPU_DEVICE:-0}"
VLM_SHM_SIZE="${VLM_SHM_SIZE:-16g}"
VLM_NETWORK_MODE="${VLM_NETWORK_MODE:-host}"
VLM_AUTO_BUILD="${VLM_AUTO_BUILD:-1}"
VLM_DETACHED="${VLM_DETACHED:-1}"
VLM_FOLLOW_LOGS="${VLM_FOLLOW_LOGS:-1}"
VLM_SHOW_LOGS="${VLM_SHOW_LOGS:-1}"

for arg in "$@"; do
  case "${arg}" in
    --follow|-f) VLM_FOLLOW_LOGS=1 ;;
    --no-follow) VLM_FOLLOW_LOGS=0 ;;
    --foreground|--fg) VLM_DETACHED=0; VLM_FOLLOW_LOGS=0 ;;
    --no-logs) VLM_SHOW_LOGS=0; VLM_FOLLOW_LOGS=0 ;;
  esac
done

if [[ "${VLM_AUTO_BUILD}" == "1" ]] && ! docker image inspect "${VLM_IMAGE}" >/dev/null 2>&1; then
  echo "이미지가 없어 build-image.sh 실행"
  bash "${SCRIPT_DIR}/build-image.sh"
fi

docker rm -f "${VLM_CONTAINER}" >/dev/null 2>&1 || true

GPU_ARGS=()
if [[ -n "${VLM_GPU_DEVICE}" ]]; then
  if [[ "${VLM_GPU_DEVICE}" == *,* ]]; then
    # GPU 2개 이상: docker run --gpus '"device=0,1"'
    GPU_ARGS=(--gpus "\"device=${VLM_GPU_DEVICE}\"")
  else
    # GPU 1개: docker run --gpus "device=0"
    GPU_ARGS=(--gpus "device=${VLM_GPU_DEVICE}")
  fi
fi

NETWORK_ARGS=()
if [[ "${VLM_NETWORK_MODE}" == "host" ]]; then
  NETWORK_ARGS=(--network host)
else
  NETWORK_ARGS=(-p "${AGENT_PORT}:9011")
fi

DATASET_HOST="${WORKSPACE_ROOT}/dataset"
mkdir -p "${DATASET_HOST}"

RUN_ARGS=(
  --name "${VLM_CONTAINER}"
  "${GPU_ARGS[@]}"
  "${NETWORK_ARGS[@]}"
  --shm-size "${VLM_SHM_SIZE}"
  -e TZ="${TZ:-Asia/Seoul}"
  -e USE_CONDA=0
  -e WORKSPACE_ROOT=/workspace
  -e AGENT_HOST=0.0.0.0
  -e AGENT_PORT=9011
  -e AUTH_TOKEN="${AUTH_TOKEN:-}"
  -v "${WORKSPACE_ROOT}:/workspace"
  -v "${DATASET_HOST}:/workspace/dataset:rw"
)

echo "VLM agent container start"
echo "  container : ${VLM_CONTAINER}"
echo "  image     : ${VLM_IMAGE}"
echo "  port      : ${AGENT_PORT}"
echo "  gpu       : ${VLM_GPU_DEVICE:-none}"

if [[ "${VLM_DETACHED}" == "1" ]]; then
  docker run -d \
    "${RUN_ARGS[@]}" \
    --restart unless-stopped \
    "${VLM_IMAGE}"

  sleep 2
  if [[ "${VLM_FOLLOW_LOGS}" == "1" ]]; then
    docker logs -f "${VLM_CONTAINER}"
  fi
else
  docker run --rm "${RUN_ARGS[@]}" "${VLM_IMAGE}"
fi
