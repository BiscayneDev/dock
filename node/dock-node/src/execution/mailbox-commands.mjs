// Fixed command builders. Untrusted spool filenames/data cannot become shell.
function binding({executionId}){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(executionId??''))throw Error('Execution binding required');return'/home/node/dock/'+executionId+'/mailbox'}
export function readMailboxCommand(input){const root=binding(input),skip=input.skip??[];if(!Array.isArray(skip)||skip.length>1000||skip.some(x=>!/^[a-f0-9-]{36}$/.test(x)))throw Error('Bound durable skip list required');const skipped=Buffer.from(JSON.stringify(skip)).toString('base64');return`python3 - <<'PY'
import os,json,pathlib,re,stat,base64
skip=set(json.loads(base64.b64decode('${skipped}')))
root=pathlib.Path('${root}')
if not root.exists():print('null');raise SystemExit
directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
for name in sorted(os.listdir(directory)):
 if not re.fullmatch(r'[a-f0-9-]{36}\\.request',name) or name[:-8] in skip:continue
 fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
 with os.fdopen(fd)as f:
  assert stat.S_ISREG(os.fstat(f.fileno()).st_mode)
  raw=f.read(80001);assert len(raw.encode())<=80000
  assert json.loads(raw).get('id')==name[:-8]
 print(json.dumps(raw));break
else:print('null')
PY`}
export function replyMailboxCommand(input){const root=binding(input);if(!/^[a-f0-9-]{36}$/.test(input.requestId??'')||typeof input.text!=='string'||Buffer.byteLength(input.text)>200000)throw Error('Bound mailbox reply required');const payload=Buffer.from(JSON.stringify({root,id:input.requestId,text:input.text})).toString('base64');return`python3 - <<'PY'
import os,json,pathlib,base64
x=json.loads(base64.b64decode('${payload}'));root=pathlib.Path(x['root'])
directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
fd=os.open(x['id']+'.response.tmp',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
with os.fdopen(fd,'w')as f:f.write(x['text']);f.flush();os.fsync(f.fileno())
os.rename(x['id']+'.response.tmp',x['id']+'.response',src_dir_fd=directory,dst_dir_fd=directory)
try:os.unlink(x['id']+'.request',dir_fd=directory)
except FileNotFoundError:pass
print(json.dumps({'replied':True}))
PY`}
