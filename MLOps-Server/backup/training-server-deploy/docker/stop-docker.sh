#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/paths.sh"
resolve_training_docker_paths "${BASH_SOURCE[0]}" 2>/dev/null || true

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi

TRAIN_CONTAINER="${TRAIN_CONTAINER:-intellivix-train-agent}"

docker rm -f "${TRAIN_CONTAINER}" >/dev/null 2>&1 || true
echo "stopped: ${TRAIN_CONTAINER}"
