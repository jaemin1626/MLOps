#!/usr/bin/env bash
# 공통 경로 탐지: docker/ 또는 training-server-deploy/docker/ 어디서 실행해도 동작

resolve_training_docker_paths() {
  local script_path="${1:-${BASH_SOURCE[1]:-$0}}"
  DOCKER_DIR="$(cd "$(dirname "${script_path}")" && pwd)"

  if [[ -f "${DOCKER_DIR}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${DOCKER_DIR}/.env"
    set +a
  fi

  if [[ -n "${MLOPS_WORKSPACE_ROOT:-}" ]]; then
    if [[ ! -d "${MLOPS_WORKSPACE_ROOT}/training-server-detector" ]]; then
      echo "오류: MLOPS_WORKSPACE_ROOT=${MLOPS_WORKSPACE_ROOT} 에 training-server-detector 가 없습니다." >&2
      return 1
    fi
    WORKSPACE_ROOT="$(cd "${MLOPS_WORKSPACE_ROOT}" && pwd)"
  else
    local candidate="${DOCKER_DIR}"
    WORKSPACE_ROOT=""
    local depth
    for depth in 1 2 3 4 5 6; do
      if [[ -d "${candidate}/training-server-detector/app" ]]; then
        WORKSPACE_ROOT="${candidate}"
        break
      fi
      candidate="$(dirname "${candidate}")"
    done
  fi

  if [[ -z "${WORKSPACE_ROOT}" ]]; then
    echo "오류: training-server-detector 폴더를 찾지 못했습니다." >&2
    echo "  docker 경로: ${DOCKER_DIR}" >&2
    echo "  아래 구조 중 하나를 사용하세요:" >&2
    echo "    Intellivix_MLops_train_server/training-server-detector/" >&2
    echo "    Intellivix_MLops_train_server/docker/" >&2
    echo "    Intellivix_MLops_train_server/training-server-deploy/docker/" >&2
    echo "  또는 .env 에 MLOPS_WORKSPACE_ROOT=/path/to/Intellivix_MLops_train_server 설정" >&2
    return 1
  fi

  AGENT_DIR="${WORKSPACE_ROOT}/training-server-detector"
  DOCKER_REL_PATH="${DOCKER_DIR#"${WORKSPACE_ROOT}/"}"
  AGENT_REL_PATH="training-server-detector"

  export DOCKER_DIR WORKSPACE_ROOT AGENT_DIR DOCKER_REL_PATH AGENT_REL_PATH
}
