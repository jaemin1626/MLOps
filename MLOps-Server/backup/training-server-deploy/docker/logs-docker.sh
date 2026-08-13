#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi

TRAIN_CONTAINER="${TRAIN_CONTAINER:-detector-agent}"

echo "=== 실시간 agent 로그 (${TRAIN_CONTAINER}) ==="
echo "REST 대기 / 명령 접수 / 수행 로그가 여기에 표시됩니다."
echo "Ctrl+C 로 로그 보기만 종료합니다. 컨테이너는 계속 실행됩니다."
echo
docker logs -f "${TRAIN_CONTAINER}"
