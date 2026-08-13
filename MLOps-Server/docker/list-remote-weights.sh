#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${PROJECT_ROOT}/docker/load-mlops-connection.sh"

MLOPS_SSH_REMOTE_WEIGHTS_PATH="${MLOPS_SSH_REMOTE_WEIGHTS_PATH:-${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}/detector/weights}"
MLOPS_SSH_REMOTE_WEIGHTS_RELATIVE="${MLOPS_SSH_REMOTE_WEIGHTS_RELATIVE:-detector/weights}"
MLOPS_WEIGHTS_INDEX_FILE="${MLOPS_WEIGHTS_INDEX_FILE:-${MLOPS_DATA_ROOT}/.mlops-weights-index.json}"

if [[ -z "${MLOPS_SSH_PASSWORD:-}" ]]; then
  echo "오류: ssh.password 가 설정되지 않았습니다 (config/mlops-connection.json 확인)." >&2
  exit 1
fi

mkdir -p "${MLOPS_DATA_ROOT}" 2>/dev/null || true

ASKPASS_SCRIPT="$(mktemp)"
trap 'rm -f "${ASKPASS_SCRIPT}"' EXIT
export MLOPS_ASKPASS_VALUE="${MLOPS_SSH_PASSWORD}"
cat > "${ASKPASS_SCRIPT}" <<'EOF'
#!/bin/sh
printf '%s\n' "$MLOPS_ASKPASS_VALUE"
EOF
chmod 700 "${ASKPASS_SCRIPT}"

remote_list="$(
  DISPLAY=:0 SSH_ASKPASS="${ASKPASS_SCRIPT}" SSH_ASKPASS_REQUIRE=force \
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    "${MLOPS_SSH_USER}@${MLOPS_SSH_HOST}" \
    "find '${MLOPS_SSH_REMOTE_WEIGHTS_PATH}' -maxdepth 1 -type f \\( -iname '*.pt' -o -iname '*.pth' \\) -printf '%f\t%s\n' 2>/dev/null | sort" \
    || true
)"

printf '%s\n' "${remote_list}" | python3 -c "
import json
import os
import sys
from datetime import datetime, timezone

workspace_root = sys.argv[1]
weights_root = sys.argv[2]
weights_relative_root = sys.argv[3]
output_path = sys.argv[4]
raw = sys.stdin.read().strip()
weights = []
for line in raw.splitlines():
    if not line.strip():
        continue
    parts = line.split('\t')
    name = parts[0]
    size_bytes = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    absolute_path = f\"{weights_root.rstrip('/')}/{name}\"
    relative_path = os.path.relpath(absolute_path, workspace_root).replace('\\\\', '/')
    weights.append({
        'name': name,
        'path': relative_path,
        'sizeBytes': size_bytes,
    })

payload = {
    'updatedAt': datetime.now(timezone.utc).astimezone().isoformat(),
    'workspaceRoot': workspace_root,
    'weightsRoot': weights_relative_root,
    'weights': weights,
}
with open(output_path, 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
print(f'weights index: {len(weights)} files -> {output_path}')
" "${MLOPS_SSH_REMOTE_WORKSPACE_ROOT}" "${MLOPS_SSH_REMOTE_WEIGHTS_PATH}" "${MLOPS_SSH_REMOTE_WEIGHTS_RELATIVE}" "${MLOPS_WEIGHTS_INDEX_FILE}"
