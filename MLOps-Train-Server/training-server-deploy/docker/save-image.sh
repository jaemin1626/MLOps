#!/usr/bin/env bash
# Intellivix_MLops_train_server/docker/save-image.sh
# 다른 서버로 옮길 때: ./save-image.sh 후 생성된 tar 파일을 복사

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi

DETECTOR_IMAGE="${DETECTOR_IMAGE:-intellivix-detector-agent:1.0.0}"
OUTPUT_FILE="${DETECTOR_IMAGE_EXPORT:-${SCRIPT_DIR}/intellivix-detector-agent.tar.gz}"
OUTPUT_FILE="${OUTPUT_FILE//:/_}"

if ! docker image inspect "${DETECTOR_IMAGE}" >/dev/null 2>&1; then
  echo "이미지가 없습니다. 먼저 ./build-image.sh 실행" >&2
  exit 1
fi

echo "export image: ${DETECTOR_IMAGE}"
echo "output    : ${OUTPUT_FILE}"

docker save "${DETECTOR_IMAGE}" | gzip > "${OUTPUT_FILE}"
ls -lh "${OUTPUT_FILE}"
echo "완료. 새 서버에서 ./load-image.sh 로 불러오세요."
