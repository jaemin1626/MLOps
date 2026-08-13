#!/usr/bin/env bash
# MLOps Platform 모니터링 서버 Docker 이미지 tar.gz 불러오기
# Usage: bash docker/load-mlops-image.sh [mlops-server-1.1.1.tar.gz]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INPUT_FILE="${1:-${PROJECT_ROOT}/mlops-server-1.1.1.tar.gz}"

if [[ ! -f "${INPUT_FILE}" ]]; then
  echo "오류: tar 파일을 찾을 수 없습니다: ${INPUT_FILE}" >&2
  exit 1
fi

echo "import image from: ${INPUT_FILE}"
gunzip -c "${INPUT_FILE}" | docker load
echo "완료. 프로젝트 설정 후 실행:"
echo "  cp config/mlops-connection.example.json config/mlops-connection.json"
echo "  bash run-mlops.sh"
