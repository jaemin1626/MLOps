#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${PROJECT_ROOT}/docker/load-mlops-connection.sh"

MLOPS_LOCAL_DATA_PATH="${MLOPS_DATA_ROOT:-${MLOPS_LOCAL_DATA_PATH:-${PROJECT_ROOT}/cache/training-dataset}}"

if [[ -z "${MLOPS_SSH_PASSWORD:-}" ]]; then
  echo "오류: ssh.password 가 설정되지 않았습니다 (config/mlops-connection.json 확인)." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "오류: rsync가 필요합니다." >&2
  exit 1
fi

mkdir -p "${MLOPS_LOCAL_DATA_PATH}" 2>/dev/null || true
if [[ ! -w "${MLOPS_LOCAL_DATA_PATH}" || ! -O "${MLOPS_LOCAL_DATA_PATH}" ]]; then
  echo "오류: ${MLOPS_LOCAL_DATA_PATH}에 쓸 수 없습니다. run-intellivix-mlops.sh로 실행하세요." >&2
  exit 1
fi

ASKPASS_SCRIPT="$(mktemp)"
trap 'rm -f "${ASKPASS_SCRIPT}"' EXIT
export MLOPS_ASKPASS_VALUE="${MLOPS_SSH_PASSWORD}"
cat > "${ASKPASS_SCRIPT}" <<'EOF'
#!/bin/sh
printf '%s\n' "$MLOPS_ASKPASS_VALUE"
EOF
chmod 700 "${ASKPASS_SCRIPT}"

echo "학습 서버 dataset 동기화 중..."
echo "  remote: ${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}:${MLOPS_SSH_REMOTE_PATH}/"
echo "  local : ${MLOPS_LOCAL_DATA_PATH}/"
echo "  mode  : mirror (--delete, 학습 서버에 없는 로컬 폴더/파일 제거)"

DISPLAY=:0 SSH_ASKPASS="${ASKPASS_SCRIPT}" SSH_ASKPASS_REQUIRE=force \
  rsync -az --partial --no-times --omit-dir-times --delete --info=stats2 \
  --exclude='.mlops-*' \
  -e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" \
  "${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}:${MLOPS_SSH_REMOTE_PATH}/" \
  "${MLOPS_LOCAL_DATA_PATH}/"

echo
echo "동기화 완료:"
ls -la "${MLOPS_LOCAL_DATA_PATH}" | head -20