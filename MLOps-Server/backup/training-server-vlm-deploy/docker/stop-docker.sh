#!/usr/bin/env bash
set -euo pipefail
VLM_CONTAINER="${VLM_CONTAINER:-vlm-agent}"
docker rm -f "${VLM_CONTAINER}" >/dev/null 2>&1 || true
echo "stopped ${VLM_CONTAINER}"
