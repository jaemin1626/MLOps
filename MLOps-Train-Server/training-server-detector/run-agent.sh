#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

CONDA_ENV_NAME="${CONDA_ENV_NAME:-yolo}"
AGENT_HOST="${AGENT_HOST:-0.0.0.0}"
AGENT_PORT="${AGENT_PORT:-9010}"

if ! command -v conda >/dev/null 2>&1; then
  echo "오류: conda를 찾을 수 없습니다. Anaconda/Miniconda 설치 후 다시 실행하세요." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate "${CONDA_ENV_NAME}"

if [[ ! -d .venv-agent ]]; then
  python -m venv .venv-agent
fi
# shellcheck disable=SC1091
source .venv-agent/bin/activate
pip install -q -r requirements.txt

export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/home/ailab2/Workspace/Intellivix_MLops_train_server}"
export AGENT_HOST AGENT_PORT

echo "Training Server Agent: http://${AGENT_HOST}:${AGENT_PORT}"
echo "Workspace root: ${WORKSPACE_ROOT}"
echo "Conda env: ${CONDA_ENV_NAME}"

exec python -m app.main
