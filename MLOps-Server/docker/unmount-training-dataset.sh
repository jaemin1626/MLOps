#!/usr/bin/env bash
set -euo pipefail

MLOPS_LOCAL_MOUNT="${MLOPS_LOCAL_MOUNT:-${HOME}/mnt/training-dataset}"

if mountpoint -q "${MLOPS_LOCAL_MOUNT}" 2>/dev/null; then
  fusermount -u "${MLOPS_LOCAL_MOUNT}" || umount "${MLOPS_LOCAL_MOUNT}"
  echo "마운트 해제: ${MLOPS_LOCAL_MOUNT}"
else
  echo "마운트되어 있지 않습니다: ${MLOPS_LOCAL_MOUNT}"
fi
