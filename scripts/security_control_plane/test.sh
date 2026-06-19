#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${ROOT_DIR}/.venv-security/bin/python"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  PYTHON_BIN="${PYTHON:-python3}"
fi

cd "${ROOT_DIR}"
PYTHONPATH=scripts/security_control_plane "${PYTHON_BIN}" -m unittest discover -s scripts/security_control_plane/tests
