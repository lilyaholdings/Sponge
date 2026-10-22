#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 or newer, then open this launcher again.'
  read -r answer
  exit 1
fi
node scripts/launch.js
