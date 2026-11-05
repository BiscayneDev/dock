# Reversible local context preparation only. Does not build/upload/publish.
# Explicit allowlist avoids Agent37 CLI ignoring dockerignore negations.
import pathlib,tempfile,shutil,json,hashlib
repo=pathlib.Path(__file__).resolve().parents[2]
files=['infra/execution-private/Dockerfile','infra/execution-private/repair.py','infra/execution-private/policy.json','infra/execution-private/settings.json','infra/execution-private/smoke.py','node/dock-node/bin/dock-private-pi.mjs','node/dock-node/bin/dock-memory-mcp.mjs','node/dock-node/src/execution/scoped-relay.mjs','node/dock-node/src/execution/chat-contract.mjs','node/dock-node/src/execution/scoped-memory-socket.mjs','node/dock-node/src/execution/private-mailbox.mjs','node/dock-node/src/execution/mailbox-runtime.mjs','node/dock-node/src/execution/memory-client.mjs','node/dock-node/src/execution/memory-mcp.mjs']
root=pathlib.Path(tempfile.mkdtemp(prefix='dock-private-build-context-'));manifest=[]
for name in files:
 source=repo/name
 assert source.is_file()and not source.is_symlink()
 target=root/('Dockerfile'if name.endswith('/Dockerfile')else name);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
 manifest.append({'path':str(target.relative_to(root)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
(root/'.dockerignore').write_text('.git\n.env*\n*.pem\n*.key\n')
print(json.dumps({'stagedContext':str(root),'files':manifest,'buildExecuted':False,'uploaded':False,'published':False}))
