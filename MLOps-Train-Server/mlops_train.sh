#!/usr/bin/env bash
# mlops-train-server/mlops_train.sh — Detector + VLM training agent 빌드/실행/상태 확인

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTOR_DEPLOY="${ROOT}/training-server-deploy/docker"
VLM_DEPLOY="${ROOT}/training-server-vlm-deploy/docker"

DETECTOR_CONTAINER="${DETECTOR_CONTAINER:-detector-agent}"
VLM_CONTAINER="${VLM_CONTAINER:-vlm-agent}"
DETECTOR_PORT="${DETECTOR_PORT:-9010}"
VLM_PORT="${VLM_PORT:-9011}"
FOLLOW_LOGS=1
SKIP_BUILD=0

for arg in "$@"; do
  case "${arg}" in
    --follow|-f) FOLLOW_LOGS=1 ;;
    --no-follow) FOLLOW_LOGS=0 ;;
    --no-build) SKIP_BUILD=1 ;;
  esac
done

wait_for_agent_health() {
  local health_url="$1"
  local max_attempts="${HEALTH_WAIT_ATTEMPTS:-30}"
  local interval="${HEALTH_WAIT_INTERVAL:-2}"
  local attempt=1
  local body=""

  while (( attempt <= max_attempts )); do
    if body="$(curl -fsS "${health_url}")"; then
      printf '%s' "${body}"
      return 0
    fi
    if (( attempt == 1 )); then
      echo "[상태] agent 기동 대기 중... (최대 $((max_attempts * interval))초)"
    fi
    sleep "${interval}"
    attempt=$((attempt + 1))
  done
  return 1
}

print_agent_status() {
  local name="$1"
  local port="$2"
  local container="$3"
  local health_url="http://127.0.0.1:${port}/api/v1/health"

  echo "=== ${name} (${health_url}) ==="
  if ! docker ps --format '{{.Names}}' | grep -qx "${container}"; then
    echo "[상태] 컨테이너가 실행 중이 아닙니다: ${container}" >&2
    return 1
  fi

  local body
  if ! body="$(wait_for_agent_health "${health_url}")"; then
    echo "[상태] health check 실패 (agent가 ${HEALTH_WAIT_ATTEMPTS:-30}회 재시도 후에도 응답하지 않음)" >&2
    docker logs --tail 20 "${container}" 2>&1 || true
    return 1
  fi

  python3 - <<'PY' "${body}" "${name}"
import json, sys
data = json.loads(sys.argv[1])
name = sys.argv[2]
state = data.get("agentState", "unknown")
waiting = data.get("waitingForCommands", False)
commands = ", ".join(data.get("supportedCommands") or [])
queued = data.get("queuedTaskCount", 0)
active = data.get("activeTaskCount", 0)

if waiting and state == "idle":
    print("[상태] REST 응답 대기 중 (waitingForCommands=true)")
elif state == "busy":
    print(f"[상태] 명령 수행 중 (agentState=busy, active={active}, queued={queued})")
else:
    print(f"[상태] agentState={state} · waitingForCommands={waiting}")

print(f"[요약] agentState={state} · waitingForCommands={waiting}")
if commands:
    print(f"[지원 명령] {commands}")
print(f"[서비스] {data.get('service', name)}")
PY

  echo
}

follow_both_logs() {
  echo "=== 실시간 agent 로그 (Detector + VLM, REST 대기 / 명령 접수 / 수행) ==="
  echo "  Detector: ${DETECTOR_CONTAINER} (port ${DETECTOR_PORT})"
  echo "  VLM     : ${VLM_CONTAINER} (port ${VLM_PORT})"
  echo "  Ctrl+C 로 로그 보기만 종료합니다. 컨테이너는 계속 실행됩니다."
  echo

  docker logs -f --tail 20 "${DETECTOR_CONTAINER}" 2>&1 | sed -u "s/^/[detector] /" &
  local detector_pid=$!
  docker logs -f --tail 20 "${VLM_CONTAINER}" 2>&1 | sed -u "s/^/[vlm]     /" &
  local vlm_pid=$!

  trap 'kill "${detector_pid}" "${vlm_pid}" 2>/dev/null || true; exit 0' INT TERM

  wait "${detector_pid}" "${vlm_pid}"
}

echo "=== MLops Training Agents ==="
echo

if [[ "${SKIP_BUILD}" == "1" ]]; then
  echo "[1/3] Docker 이미지 빌드 — 건너뜀 (--no-build)"
else
  echo "[1/3] Docker 이미지 빌드"
  bash "${DETECTOR_DEPLOY}/build-image.sh"
  bash "${VLM_DEPLOY}/build-image.sh"
fi
echo

echo "[2/3] 컨테이너 실행"
DETECTOR_GPU_DEVICE="${DETECTOR_GPU_DEVICE:-0}" bash "${DETECTOR_DEPLOY}/run-docker.sh" --no-follow --no-logs
VLM_GPU_DEVICE="${VLM_GPU_DEVICE:-0,1}" bash "${VLM_DEPLOY}/run-docker.sh" --no-follow --no-logs
echo

echo "[3/3] Agent 상태 확인"
print_agent_status "Detector Agent" "${DETECTOR_PORT}" "${DETECTOR_CONTAINER}"
print_agent_status "VLM Agent" "${VLM_PORT}" "${VLM_CONTAINER}"

echo "설치/실행 완료"
echo "  Detector health : http://127.0.0.1:${DETECTOR_PORT}/api/v1/health"
echo "  VLM health      : http://127.0.0.1:${VLM_PORT}/api/v1/health"

if [[ "${FOLLOW_LOGS}" == "1" ]]; then
  echo
  follow_both_logs
else
  echo "  Detector logs   : docker logs -f ${DETECTOR_CONTAINER}"
  echo "  VLM logs        : docker logs -f ${VLM_CONTAINER}"
  echo
  echo "실시간 로그 follow: bash ${ROOT}/mlops_train.sh --no-build --follow"
fi
