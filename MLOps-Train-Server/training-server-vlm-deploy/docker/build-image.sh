#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/paths.sh"
resolve_vlm_docker_paths "${BASH_SOURCE[0]}"

VLM_IMAGE="${VLM_IMAGE:-vlm-agent:1.0.0}"
VLM_FORCE_REBUILD="${VLM_FORCE_REBUILD:-0}"

if [[ "${VLM_FORCE_REBUILD}" == "1" ]]; then
  BUILD_ARGS=(--no-cache)
else
  BUILD_ARGS=()
fi

echo "VLM Docker image build"
echo "  workspace : ${WORKSPACE_ROOT}"
echo "  agent     : ${AGENT_REL_PATH}"
echo "  docker    : ${DOCKER_REL_PATH}"
echo "  image     : ${VLM_IMAGE}"

REQUIRED_AGENT_FILES=(
  "${AGENT_DIR}/app/main.py"
  "${AGENT_DIR}/app/job_manager.py"
  "${AGENT_DIR}/train_vlm.py"
)
for required_file in "${REQUIRED_AGENT_FILES[@]}"; do
  if [[ ! -f "${required_file}" ]]; then
    echo "오류: 필수 agent 파일이 없습니다: ${required_file}" >&2
    exit 1
  fi
done

docker build "${BUILD_ARGS[@]}" \
  --build-arg "DOCKER_SUBPATH=${DOCKER_REL_PATH}" \
  --build-arg "AGENT_SUBPATH=${AGENT_REL_PATH}" \
  -f "${DOCKER_DIR}/Dockerfile" \
  -t "${VLM_IMAGE}" \
  "${WORKSPACE_ROOT}"

echo
echo "완료: ${VLM_IMAGE}"
docker images "${VLM_IMAGE}"
