#!/usr/bin/env bash
# VLM agent Docker 경로 탐지

resolve_vlm_docker_paths() {
  local script_path="${1:-${BASH_SOURCE[1]:-$0}}"
  DOCKER_DIR="$(cd "$(dirname "${script_path}")" && pwd)"

  if [[ -f "${DOCKER_DIR}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${DOCKER_DIR}/.env"
    set +a
  fi

  if [[ -n "${MLOPS_WORKSPACE_ROOT:-}" ]]; then
    if [[ ! -d "${MLOPS_WORKSPACE_ROOT}/training-server-vlm" ]]; then
      echo "오류: MLOPS_WORKSPACE_ROOT=${MLOPS_WORKSPACE_ROOT} 에 training-server-vlm 이 없습니다." >&2
      return 1
    fi
    WORKSPACE_ROOT="$(cd "${MLOPS_WORKSPACE_ROOT}" && pwd)"
  else
    local candidate="${DOCKER_DIR}"
    WORKSPACE_ROOT=""
    local depth
    for depth in 1 2 3 4 5 6; do
      if [[ -d "${candidate}/training-server-vlm/app" ]]; then
        WORKSPACE_ROOT="${candidate}"
        break
      fi
      candidate="$(dirname "${candidate}")"
    done
  fi

  if [[ -z "${WORKSPACE_ROOT}" ]]; then
    echo "오류: training-server-vlm 폴더를 찾지 못했습니다." >&2
    echo "  docker 경로: ${DOCKER_DIR}" >&2
    return 1
  fi

  AGENT_DIR="${WORKSPACE_ROOT}/training-server-vlm"
  DOCKER_REL_PATH="${DOCKER_DIR#"${WORKSPACE_ROOT}/"}"
  AGENT_REL_PATH="training-server-vlm"

  export DOCKER_DIR WORKSPACE_ROOT AGENT_DIR DOCKER_REL_PATH AGENT_REL_PATH
}
