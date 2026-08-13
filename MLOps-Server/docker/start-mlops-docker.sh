#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "오류: docker 명령을 찾을 수 없습니다." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "오류: Docker Compose v2를 사용할 수 없습니다." >&2
  exit 1
fi

export MLOPS_UID="${MLOPS_UID:-$(id -u)}"
export MLOPS_GID="${MLOPS_GID:-$(id -g)}"
export MLOPS_HOST_PORT="${MLOPS_HOST_PORT:-18088}"
export MLOPS_WORKSPACE_PATH="${MLOPS_WORKSPACE_PATH:-./workspace}"
export MLOPS_EXTERNAL_DATA_PATH="${MLOPS_EXTERNAL_DATA_PATH:-./workspace/data}"

mkdir -p \
  "${MLOPS_WORKSPACE_PATH}" \
  "${MLOPS_EXTERNAL_DATA_PATH}" \
  "${MLOPS_WORKSPACE_PATH}/jobs/running" \
  "${MLOPS_WORKSPACE_PATH}/jobs/completed" \
  "${MLOPS_WORKSPACE_PATH}/jobs/failed" \
  "${MLOPS_WORKSPACE_PATH}/models" \
  "${MLOPS_WORKSPACE_PATH}/exports" \
  "${MLOPS_WORKSPACE_PATH}/logs"

docker compose up --detach --build

CONTAINER_PORT="$(docker compose port mlops-server 8080 2>/dev/null || true)"
if [[ -n "${CONTAINER_PORT}" ]]; then
  echo "MLOps Platform가 실행되었습니다: http://localhost:${CONTAINER_PORT##*:}"
else
  echo "MLOps Platform가 실행되었습니다: http://localhost:${MLOPS_HOST_PORT}"
fi

echo "상태 확인: docker compose ps"
echo "로그 확인: ./docker/view-mlops-server-docker-logs.sh"