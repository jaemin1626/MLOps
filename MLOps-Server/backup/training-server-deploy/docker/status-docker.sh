#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi

TRAIN_CONTAINER="${TRAIN_CONTAINER:-detector-agent}"
AGENT_PORT="${AGENT_PORT:-9010}"
HEALTH_URL="http://127.0.0.1:${AGENT_PORT}/api/v1/health"

format_json() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool
  elif command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

echo "=== docker ps ==="
docker ps --filter "name=${TRAIN_CONTAINER}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true

echo
echo "=== agent health (${HEALTH_URL}) ==="
if HEALTH_BODY="$(curl -fsS "${HEALTH_URL}")"; then
  echo "${HEALTH_BODY}" | format_json
  echo
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY' "${HEALTH_BODY}"
import json, sys
data = json.loads(sys.argv[1])
state = data.get("agentState", "unknown")
waiting = data.get("waitingForCommands", False)
commands = ", ".join(data.get("supportedCommands") or [])
print(f"[요약] agentState={state} · waitingForCommands={waiting}")
if commands:
    print(f"[지원 명령] {commands}")
PY
  fi
else
  echo "health check failed: ${HEALTH_URL}" >&2
  echo
  echo "=== recent container logs ==="
  docker logs --tail 50 "${TRAIN_CONTAINER}" 2>&1 || true
  exit 1
fi

echo
echo "=== recent container logs (마지막 30줄) ==="
docker logs --tail 30 "${TRAIN_CONTAINER}" 2>&1 || true

echo
echo "실시간 로그: bash ${SCRIPT_DIR}/logs-docker.sh"
echo "재시작+로그 follow: bash ${SCRIPT_DIR}/restart-docker.sh"
