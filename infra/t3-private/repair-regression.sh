#!/bin/sh
set -eu
image="$1"
name="dock-admin-repair-test"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker create --name "$name" --entrypoint sleep "$image" 300
docker start "$name"
# Recreate the exact broken installer directory mode from template revision1.
docker exec --user root "$name" chown node:node /opt/dock-t3-runtime/package.json
docker exec --user root "$name" chmod 0500 /opt/dock-t3-runtime
if docker exec --user node "$name" /opt/dock-t3-runtime/t3 --version; then
  echo 'Expected old0500 runtime failure' >&2; exit 1
fi
# Workload cannot make this repair itself or elevate via the installed image.
docker exec --user node "$name" python3 -c 'import os,subprocess,shutil; assert os.getuid()!=0; assert not shutil.which("sudo"); assert subprocess.run(["chmod","0555","/opt/dock-t3-runtime"]).returncode!=0; assert not os.environ.get("AGENT37_API_KEY")'
docker cp infra/t3-private/repair.py "$name":/tmp/dock-owner-repair.py
docker exec --user root "$name" python3 /tmp/dock-owner-repair.py
docker exec --user node "$name" python3 /opt/dock-image-smoke.py
docker exec --user node "$name" python3 -c 'import os; assert os.getuid()!=0; assert not os.access("/opt/dock-t3-runtime",os.W_OK); assert not os.access("/etc/t3code/policy.json",os.W_OK); print("WORKLOAD_REMAINS_NONROOT_READONLY_OK")'
