#!/usr/bin/env bash
# config/mlops-connection.json 을 읽어 shell 환경 변수로 export 합니다.
set -euo pipefail

_LOADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_MLOPS_PROJECT_ROOT="$(cd "${_LOADER_DIR}/.." && pwd)"

if [[ -f "${_MLOPS_PROJECT_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${_MLOPS_PROJECT_ROOT}/.env"
  set +a
fi

MLOPS_CONNECTION_FILE="${MLOPS_CONNECTION_FILE:-${_MLOPS_PROJECT_ROOT}/config/mlops-connection.json}"
export MLOPS_CONNECTION_FILE

if [[ ! -f "${MLOPS_CONNECTION_FILE}" ]]; then
  echo "오류: 연결 설정 파일이 없습니다: ${MLOPS_CONNECTION_FILE}" >&2
  echo "  cp config/mlops-connection.example.json config/mlops-connection.json" >&2
  exit 1
fi

eval "$(
  python3 - "${MLOPS_CONNECTION_FILE}" <<'PY'
import json
import shlex
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)

mlops = data.get("mlopsHost") or {}
training = data.get("trainingServer") or {}
vlm = data.get("vlmTrainingServer") or {}
ssh = data.get("ssh") or {}

host = str(training.get("host") or ssh.get("host") or "").strip()
vlm_host = str(vlm.get("host") or host).strip()
port = int(training.get("agentPort") or 9010)
vlm_port = int(vlm.get("agentPort") or 9011)
mlops_port = int(mlops.get("port") or 18088)
api_base = str(training.get("apiBaseUrl") or training.get("baseUrl") or "").strip()
vlm_api_base = str(vlm.get("apiBaseUrl") or vlm.get("baseUrl") or "").strip()
if not api_base and host:
    api_base = f"http://{host}:{port}"
if not vlm_api_base and vlm_host:
    vlm_api_base = f"http://{vlm_host}:{vlm_port}"

remote_workspace = str(ssh.get("remoteWorkspaceRoot") or "").rstrip("/")
remote_dataset = str(ssh.get("remoteDatasetPath") or f"{remote_workspace}/dataset").rstrip("/")
public_base = str(mlops.get("publicBaseUrl") or f"http://127.0.0.1:{mlops_port}").rstrip("/")

pairs = {
    "MLOPS_CONNECTION_FILE": path,
    "MLOPS_HOST_PORT": str(mlops_port),
    "MLOPS_GPU_DEVICE": str(mlops.get("gpuDevice") or ""),
    "MLOPS_PUBLIC_BASE_URL": public_base,
    "MLOPS_DATA_ROOT": str(mlops.get("dataRoot") or "./cache/training-dataset"),
    "MLOPS_WORKSPACE_PATH": str(mlops.get("workspacePath") or "./workspace"),
    "MLOPS_SYNC_ON_START": "0" if mlops.get("syncOnStart") is False else "1",
    "TZ": str(mlops.get("timezone") or "Asia/Seoul"),
    "TRAINING_WORKSPACE_ROOT": str(training.get("workspaceRoot") or "/workspace").rstrip("/"),
    "MLOPS_TRAINING_SERVER_URL": api_base.rstrip("/"),
    "MLOPS_VLM_TRAINING_SERVER_URL": vlm_api_base.rstrip("/"),
    "MLOPS_TRAINING_SERVER_TOKEN": str(training.get("authToken") or ""),
    "MLOPS_SSH_HOST": str(ssh.get("host") or host),
    "MLOPS_SSH_USER": str(ssh.get("user") or ""),
    "MLOPS_SSH_PASSWORD": str(ssh.get("password") or ""),
    "MLOPS_SSH_REMOTE_WORKSPACE_ROOT": remote_workspace,
    "MLOPS_SSH_REMOTE_PATH": remote_dataset,
}

for key, value in pairs.items():
    print(f"export {key}={shlex.quote(value)}")
PY
)"
