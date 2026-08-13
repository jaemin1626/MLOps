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

DETECTOR_CONTAINER="${DETECTOR_CONTAINER:-intellivix-detector-agent}"
AGENT_PORT="${AGENT_PORT:-9010}"
HEALTH_URL="http://127.0.0.1:${AGENT_PORT}/api/v1/health"
HEALTH_WAIT_ATTEMPTS="${HEALTH_WAIT_ATTEMPTS:-30}"
HEALTH_WAIT_INTERVAL="${HEALTH_WAIT_INTERVAL:-2}"

wait_for_health() {
  local url="$1"
  local max_attempts="$2"
  local interval="$3"
  local attempt=1

  while (( attempt <= max_attempts )); do
    if HEALTH_BODY="$(curl -fsS "${url}")"; then
      return 0
    fi
    if (( attempt == 1 )); then
      echo "agent 기동 대기 중... (Ultralytics/Flask 로딩, 최대 $((max_attempts * interval))초)"
    fi
    sleep "${interval}"
    attempt=$((attempt + 1))
  done
  return 1
}

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
docker ps --filter "name=${DETECTOR_CONTAINER}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true

echo
echo "=== agent health (${HEALTH_URL}) ==="
if wait_for_health "${HEALTH_URL}" "${HEALTH_WAIT_ATTEMPTS}" "${HEALTH_WAIT_INTERVAL}"; then
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
  docker logs --tail 50 "${DETECTOR_CONTAINER}" 2>&1 || true
  exit 1
fi

echo
echo "=== recent container logs (마지막 30줄) ==="
docker logs --tail 30 "${DETECTOR_CONTAINER}" 2>&1 || true

echo
echo "실시간 로그: bash ${SCRIPT_DIR}/logs-docker.sh"
echo "재시작+로그 follow: bash ${SCRIPT_DIR}/restart-docker.sh"
