#!/usr/bin/env bash
# Runs a test of tests/ (headless Chromium) on another machine, which
# reaches the app served here (the development server, or
# scripts/serve.mjs) through ssh, at localhost: the page stays
# cross-origin isolated. The other machine needs node and playwright in
# REMOTE_DIR (default ~/rocq-web-tests: npm i playwright, then
# PLAYWRIGHT_BROWSERS_PATH=REMOTE_DIR/browsers npx playwright install
# chromium).
#   tests/remote.sh [-p SSH_PORT] HOST TEST.mjs [ARGS...]
# LOCAL_PORT: the app's port here (default 5173); REMOTE_PORT: its port
# there (default 15000 + LOCAL_PORT % 1000), one for each test running.
set -euo pipefail
cd "$(dirname "$0")/.."
ssh_port=22
if [ "${1:-}" = -p ]; then ssh_port=$2; shift 2; fi
host=$1; test=$2; shift 2
dir=${REMOTE_DIR:-rocq-web-tests}
local_port=${LOCAL_PORT:-5173}
remote_port=${REMOTE_PORT:-$((15000 + local_port % 1000))}
rsync -a -e "ssh -p $ssh_port" tests/ "$host:$dir/tests/"
args=$([ $# -eq 0 ] || printf ' %q' "$@")
ssh -p "$ssh_port" -o ExitOnForwardFailure=yes -R "$remote_port:localhost:$local_port" "$host" \
  "cd $dir && PLAYWRIGHT_DIR=\$PWD ROCQ_WEB_URL=http://localhost:$remote_port/ ${SCREENSHOT:+SCREENSHOT=/tmp/rocq-web-screenshot.png} ${COLOR_SCHEME:+COLOR_SCHEME=$COLOR_SCHEME} node tests/$(basename "$test")$args"
# SCREENSHOT=FILE.png: the test's screenshot, copied here
if [ -n "${SCREENSHOT:-}" ]; then scp -q -P "$ssh_port" "$host:/tmp/rocq-web-screenshot.png" "$SCREENSHOT"; fi
