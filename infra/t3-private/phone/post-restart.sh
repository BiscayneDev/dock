#!/bin/bash
set -euo pipefail
# Same fixed persistent T3 base contains owner Connect state and private git tree.
# Lock in start.sh prevents duplicate servers after manual invocation/checkpoint.
nohup /bin/bash /home/node/dock-phone/start.sh </dev/null >/home/node/dock-phone/supervisor.log 2>&1 &
