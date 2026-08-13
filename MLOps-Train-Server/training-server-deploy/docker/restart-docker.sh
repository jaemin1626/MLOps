#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "${SCRIPT_DIR}/stop-docker.sh"

has_follow=0
has_no_follow=0
for arg in "$@"; do
  case "${arg}" in
    --follow|-f) has_follow=1 ;;
    --no-follow) has_no_follow=1 ;;
  esac
done
if [[ "${has_no_follow}" == "0" ]] && [[ "${has_follow}" == "0" ]]; then
  set -- "$@" --follow
fi

bash "${SCRIPT_DIR}/run-docker.sh" "$@"
