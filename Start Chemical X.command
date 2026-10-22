#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ ! -f scripts/launch.js ]; then
  echo 'Extract the entire ZIP first, then open this launcher inside the extracted folder.'
  read -r answer
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js was not found. Install Node.js 24.5 or newer from https://nodejs.org/ and reopen this launcher.'
  read -r answer
  exit 1
fi
node scripts/launch.js
status=$?
if [ "$status" -ne 0 ]; then
  echo 'Startup failed. Copy the error above. Press Enter to close.'
  read -r answer
fi
exit "$status"
