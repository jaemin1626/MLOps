#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/paths.sh"
resolve_training_docker_paths "${BASH_SOURCE[0]}"

DETECTOR_IMAGE="${DETECTOR_IMAGE:-detector-agent:1.0.0}"
DETECTOR_FORCE_REBUILD="${DETECTOR_FORCE_REBUILD:-0}"

if [[ "${DETECTOR_FORCE_REBUILD}" == "1" ]]; then
  BUILD_ARGS=(--no-cache)
else
  BUILD_ARGS=()
fi

echo "Docker image build"
echo "  workspace : ${WORKSPACE_ROOT}"
echo "  agent     : ${AGENT_REL_PATH}"
echo "  docker    : ${DOCKER_REL_PATH}"
echo "  dockerfile: ${DOCKER_DIR}/Dockerfile"
echo "  image     : ${DETECTOR_IMAGE}"

REQUIRED_AGENT_FILES=(
  "${AGENT_DIR}/app/main.py"
  "${AGENT_DIR}/app/export_manager.py"
  "${AGENT_DIR}/app/runs_catalog.py"
  "${AGENT_DIR}/export_onnx.py"
  "${AGENT_DIR}/pseudo_label.py"
  "${AGENT_DIR}/train_detector.py"
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
  -t "${DETECTOR_IMAGE}" \
  "${WORKSPACE_ROOT}"

echo
echo "완료: ${DETECTOR_IMAGE}"
docker images "${DETECTOR_IMAGE}"