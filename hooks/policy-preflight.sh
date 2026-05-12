#!/usr/bin/env bash
set -euo pipefail

payload="${1:-}"
if printf '%s' "$payload" | grep -Eiq 'rm -rf|git reset --hard|DROP TABLE'; then
  echo "ROI policy-preflight denied risky payload."
  exit 2
fi

echo "ROI policy-preflight allowed payload."
