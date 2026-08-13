#!/usr/bin/env bash
set -euo pipefail

RUNTIME_UID="${MLOPS_RUNTIME_UID:-$(id -u)}"
RUNTIME_GID="${MLOPS_RUNTIME_GID:-$(id -g)}"
RUNTIME_USER="${MLOPS_RUNTIME_USER:-mlops-runtime}"

if ! getent group "${RUNTIME_GID}" >/dev/null 2>&1; then
  echo "${RUNTIME_USER}:x:${RUNTIME_GID}:" >> /etc/group
fi

if ! getent passwd "${RUNTIME_UID}" >/dev/null 2>&1; then
  echo "${RUNTIME_USER}:x:${RUNTIME_UID}:${RUNTIME_GID}:MLOps Runtime:/tmp:/bin/sh" >> /etc/passwd
fi

if [[ "$(id -u)" -eq 0 && "${RUNTIME_UID}" != "0" ]]; then
  exec runuser -u "${RUNTIME_USER}" -- node server/mlops-server.js
fi

exec node server/mlops-server.js
