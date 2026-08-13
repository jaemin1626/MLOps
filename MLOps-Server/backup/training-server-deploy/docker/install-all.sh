#!/usr/bin/env bash
# mlops-train-server/docker/install-all.sh
# 처음 설치: build + run + health check

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "${SCRIPT_DIR}/build-image.sh"
bash "${SCRIPT_DIR}/run-docker.sh"

echo
echo "설치 완료"
echo "  health : http://127.0.0.1:${AGENT_PORT:-9010}/api/v1/health"
echo "  logs   : docker logs -f ${TRAIN_CONTAINER:-detector-agent}"
