#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

docker compose ps

CONTAINER_ID="$(docker compose ps --quiet mlops-server)"
if [[ -n "${CONTAINER_ID}" ]]; then
  docker inspect --format='health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}} status={{.State.Status}}' "${CONTAINER_ID}"
fi
