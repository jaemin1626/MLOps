#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
export AGENT_PORT="${AGENT_PORT:-9011}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
exec python start.py
