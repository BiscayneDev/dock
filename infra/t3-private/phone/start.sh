#!/bin/bash
# Owner phone host only. Workload never receives a management credential.
# Install at /home/node/dock-phone/start.sh, invoked by post-restart.sh.
set -euo pipefail
[ "$(id -u)" != 0 ] || exit 1
root=/home/node/dock-phone
base=/home/node/dock-phone/t3
mkdir -p "$root" "$base"
exec 9>"$root/server.lock"
flock -n 9 || exit 0
while true; do
  # Policy startup is fail-closed. Do not repair or install tools as the agent.
  /opt/dock-t3-runtime/t3 serve --host 127.0.0.1 --port 3773 --base-dir "$base" >>"$root/t3.log" 2>&1 || true
  sleep 5
done
