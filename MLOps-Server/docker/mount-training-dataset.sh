#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MLOPS_SSH_HOST="${MLOPS_SSH_HOST:-172.16.8.60}"
MLOPS_SSH_USER="${MLOPS_SSH_USER:-ailab2}"
MLOPS_SSH_REMOTE_PATH="${MLOPS_SSH_REMOTE_PATH:-/home/ailab2/Workspace/MLops_test/dataset}"
MLOPS_LOCAL_MOUNT="${MLOPS_LOCAL_MOUNT:-${PROJECT_ROOT}/cache/ailab2-dataset}"

if ! command -v sshfs >/dev/null 2>&1; then
  echo "오류: sshfs가 설치되어 있지 않습니다." >&2
  echo "관리자에게 다음 설치를 요청하세요: sudo apt install sshfs sshpass" >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "오류: sshpass가 설치되어 있지 않습니다." >&2
  echo "관리자에게 다음 설치를 요청하세요: sudo apt install sshpass" >&2
  exit 1
fi

if [[ -z "${MLOPS_SSH_PASSWORD:-}" ]]; then
  read -r -s -p "${MLOPS_SSH_USER}@${MLOPS_SSH_HOST} 비밀번호: " MLOPS_SSH_PASSWORD
  echo
fi

mkdir -p "${MLOPS_LOCAL_MOUNT}"

if mountpoint -q "${MLOPS_LOCAL_MOUNT}" 2>/dev/null; then
  echo "이미 마운트됨: ${MLOPS_LOCAL_MOUNT}"
else
  sshpass -p "${MLOPS_SSH_PASSWORD}" sshfs \
    "${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}:${MLOPS_SSH_REMOTE_PATH}" \
    "${MLOPS_LOCAL_MOUNT}" \
    -o StrictHostKeyChecking=no \
    -o reconnect \
    -o ServerAliveInterval=15 \
    -o follow_symlinks
  echo "마운트 완료: ${MLOPS_LOCAL_MOUNT}"
fi

echo
echo "원격 dataset 내용:"
ls -la "${MLOPS_LOCAL_MOUNT}" | head -20
echo
echo "MLOps 실행:"
echo "  MLOPS_DATA_ROOT=${MLOPS_LOCAL_MOUNT} bash ${PROJECT_ROOT}/run-intellivix-mlops.sh"
