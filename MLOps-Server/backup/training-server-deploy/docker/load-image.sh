#!/usr/bin/env bash
# MLops_test/docker/load-image.sh
# Usage: ./load-image.sh [intellivix-train-agent.tar.gz]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT_FILE="${1:-${SCRIPT_DIR}/intellivix-train-agent.tar.gz}"

if [[ ! -f "${INPUT_FILE}" ]]; then
  echo "오류: tar 파일을 찾을 수 없습니다: ${INPUT_FILE}" >&2
  exit 1
fi

echo "import image from: ${INPUT_FILE}"
gunzip -c "${INPUT_FILE}" | docker load
echo "완료. ./run-docker.sh 로 실행하세요."
