#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKUP_ROOT}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

MLOPS_CONNECTION_FILE="${MLOPS_CONNECTION_FILE:-${REPO_ROOT}/config/mlops-connection.json}"
# shellcheck disable=SC1091
source "${REPO_ROOT}/docker/load-mlops-connection.sh"

MLOPS_AGENT_REBUILD="${MLOPS_AGENT_REBUILD:-0}"
MLOPS_VLM_AGENT_REBUILD="${MLOPS_VLM_AGENT_REBUILD:-0}"
SYNC_TARGET="${SYNC_TARGET:-all}"

if [[ -z "${MLOPS_SSH_PASSWORD:-}" ]]; then
  echo "오류: ssh.password 가 설정되지 않았습니다 (config/mlops-connection.json 확인)." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "오류: rsync가 필요합니다." >&2
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
REMOTE="${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}"

if command -v sshpass >/dev/null 2>&1; then
  export SSHPASS="${MLOPS_SSH_PASSWORD}"
  SSH_BIN=(sshpass -e ssh "${SSH_OPTS[@]}")
  RSYNC_SSH=(sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
else
  ASKPASS_SCRIPT="$(mktemp)"
  trap 'rm -f "${ASKPASS_SCRIPT}"' EXIT
  export MLOPS_ASKPASS_VALUE="${MLOPS_SSH_PASSWORD}"
  cat > "${ASKPASS_SCRIPT}" <<'EOF'
#!/bin/sh
printf '%s\n' "$MLOPS_ASKPASS_VALUE"
EOF
  chmod 700 "${ASKPASS_SCRIPT}"
  export DISPLAY="${DISPLAY:-:0}"
  export SSH_ASKPASS="${ASKPASS_SCRIPT}"
  export SSH_ASKPASS_REQUIRE=force
  SSH_BIN=(ssh "${SSH_OPTS[@]}")
  RSYNC_SSH=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
fi

RSYNC_BASE=(
  rsync -az --partial --no-times --omit-dir-times --info=stats2
  -e "${RSYNC_SSH[*]}"
)

echo "학습 서버 agent 코드 동기화"
echo "  remote workspace: ${REMOTE}:${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}"
echo "  sync target     : ${SYNC_TARGET}"

sync_detector=0
sync_vlm=0
case "${SYNC_TARGET}" in
  detector) sync_detector=1 ;;
  vlm) sync_vlm=1 ;;
  all) sync_detector=1; sync_vlm=1 ;;
  *)
    echo "오류: SYNC_TARGET 은 all, detector, vlm 중 하나여야 합니다." >&2
    exit 1
    ;;
esac

if [[ "${sync_detector}" == "1" ]]; then
  echo
  echo "[detector] training-server-detector"
  "${RSYNC_BASE[@]}" \
    --exclude='__pycache__/' --exclude='*.pyc' \
    "${BACKUP_ROOT}/training-server-detector/" \
    "${REMOTE}:${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/training-server-detector/"

  echo
  echo "[detector] docker deploy scripts"
  "${RSYNC_BASE[@]}" \
    "${BACKUP_ROOT}/training-server-deploy/docker/" \
    "${REMOTE}:${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/docker/"
fi

if [[ "${sync_vlm}" == "1" ]]; then
  echo
  echo "[vlm] training-server-vlm"
  "${RSYNC_BASE[@]}" \
    --exclude='__pycache__/' --exclude='*.pyc' \
    "${BACKUP_ROOT}/training-server-vlm/" \
    "${REMOTE}:${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/training-server-vlm/"

  echo
  echo "[vlm] docker deploy scripts"
  "${RSYNC_BASE[@]}" \
    "${BACKUP_ROOT}/training-server-vlm-deploy/docker/" \
    "${REMOTE}:${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/docker-vlm/"
fi

if [[ "${MLOPS_AGENT_REBUILD}" == "1" && "${sync_detector}" == "1" ]]; then
  echo
  echo "원격 detector agent Docker 재빌드/재시작 중..."
  "${SSH_BIN[@]}" "${REMOTE}" \
    "cd '${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/docker' && chmod +x *.sh && TRAIN_FORCE_REBUILD=1 ./build-image.sh && ./restart-docker.sh --no-follow"
fi

if [[ "${MLOPS_VLM_AGENT_REBUILD}" == "1" && "${sync_vlm}" == "1" ]]; then
  echo
  echo "원격 VLM agent Docker 재빌드/재시작 중..."
  "${SSH_BIN[@]}" "${REMOTE}" \
    "cd '${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/docker-vlm' && chmod +x *.sh && VLM_FORCE_REBUILD=1 ./build-image.sh && ./restart-docker.sh --no-follow"
fi

echo
echo "동기화 완료."
if [[ "${MLOPS_AGENT_REBUILD}" != "1" && "${MLOPS_VLM_AGENT_REBUILD}" != "1" ]]; then
  echo "학습 서버에서 아래를 실행하세요:"
  if [[ "${sync_detector}" == "1" ]]; then
    echo "  cd ${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/docker"
    echo "  TRAIN_FORCE_REBUILD=1 ./build-image.sh && ./restart-docker.sh"
  fi
  if [[ "${sync_vlm}" == "1" ]]; then
    echo "  cd ${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/docker-vlm"
    echo "  VLM_FORCE_REBUILD=1 ./build-image.sh && ./restart-docker.sh"
  fi
  echo
  echo "또는 MLOps 호스트에서 원격 재빌드:"
  echo "  MLOPS_AGENT_REBUILD=1 bash backup/docker/sync-training-agent.sh"
  echo "  MLOPS_VLM_AGENT_REBUILD=1 bash backup/docker/sync-training-agent.sh"
fi
