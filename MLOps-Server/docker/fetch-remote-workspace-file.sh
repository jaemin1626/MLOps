#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: fetch-remote-workspace-file.sh <workspace-relative-path> <local-output-path>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${PROJECT_ROOT}/docker/load-mlops-connection.sh"

RELATIVE_PATH="${1//\\//}"
OUTPUT_PATH="$2"

if [[ -z "${MLOPS_SSH_PASSWORD:-}" ]]; then
  echo "MLOPS_SSH_PASSWORD가 설정되지 않았습니다. config/mlops-connection.json 을 확인하세요." >&2
  exit 1
fi

if [[ "${RELATIVE_PATH}" == /* || "${RELATIVE_PATH}" == *".."* ]]; then
  echo "허용되지 않은 workspace 상대 경로입니다: ${RELATIVE_PATH}" >&2
  exit 1
fi

REMOTE_PATH="${MLOPS_SSH_REMOTE_WORKSPACE_ROOT%/}/${RELATIVE_PATH}"
mkdir -p "$(dirname "${OUTPUT_PATH}")"

ASKPASS_SCRIPT="$(mktemp)"
trap 'rm -f "${ASKPASS_SCRIPT}"' EXIT
export MLOPS_ASKPASS_VALUE="${MLOPS_SSH_PASSWORD}"
cat > "${ASKPASS_SCRIPT}" <<'EOF'
#!/bin/sh
printf '%s\n' "$MLOPS_ASKPASS_VALUE"
EOF
chmod 700 "${ASKPASS_SCRIPT}"

REMOTE_EXISTS="$(
  DISPLAY=:0 SSH_ASKPASS="${ASKPASS_SCRIPT}" SSH_ASKPASS_REQUIRE=force \
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    "${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}" \
    "test -f \"${REMOTE_PATH}\" && echo yes || echo no"
)"

if [[ "${REMOTE_EXISTS}" != "yes" ]]; then
  echo "원격 파일을 찾을 수 없습니다: ${REMOTE_PATH}" >&2
  exit 1
fi

DISPLAY=:0 SSH_ASKPASS="${ASKPASS_SCRIPT}" SSH_ASKPASS_REQUIRE=force \
  scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}:${REMOTE_PATH}" "${OUTPUT_PATH}"

if [[ ! -s "${OUTPUT_PATH}" ]]; then
  echo "다운로드한 파일이 비어 있습니다: ${OUTPUT_PATH}" >&2
  exit 1
fi
