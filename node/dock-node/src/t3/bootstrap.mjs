// Build a fixed private-instance bootstrap. Requires the configured image to
// already have administrator-installed T3/Pi + read-only /etc/t3code policy.
// No runtime installer/custom image publication or account login is hidden here.
export function privateBootstrap({task,snapshot}){
 if(!/^[a-z0-9-]{36}$/.test(task.id)||! /^[a-f0-9]{40}$/.test(task.base_sha)||snapshot.baseSha!==task.base_sha)throw new Error('Invalid snapshot identity')
 const root=`/home/node/dock/${task.id}`,baseDir=`/home/node/dock-t3/${task.id}`
 const payload=Buffer.from(JSON.stringify({files:snapshot.files,baseSha:task.base_sha,executionId:task.execution_id,root,baseDir})).toString('base64')
 return `set -eu
python3 - <<'PY'
import os,json,base64,subprocess,stat,time,urllib.request,shutil
x=json.loads(base64.b64decode('${payload}'))
assert not os.environ.get('AGENT37_API_KEY') and not os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
p='/etc/t3code/policy.json'
s=os.stat(p,follow_symlinks=False)
assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and not(s.st_mode&0o022), 'administrator-owned policy required'
assert not os.access(p,os.W_OK), 'agent must not be able to write managed policy'
policy=json.load(open(p))
assert policy.get('limits',{}).get('maxRuntimeMode')=='approval-required'
root=x['root'];os.makedirs(root,mode=0o700,exist_ok=False)
base=root+'/base';work=root+'/work';os.mkdir(base,0o700)
for f in x['files']:
 parts=f['path'].split('/')
 assert all(z not in ('','.','..') and not z.startswith('.') for z in parts)
 path=base+'/'+f['path'];os.makedirs(os.path.dirname(path),exist_ok=True)
 with open(path,'xb') as out:out.write(base64.b64decode(f['base64'],validate=True))
def git(*args):return subprocess.run(['git','-C',base,*args],check=True,capture_output=True)
git('init','-b','base');git('add','.');git('-c','user.name=Dock','-c','user.email=dock@localhost','commit','-m','Private committed base '+x['baseSha']);git('worktree','add',work,'-b','dock/task-'+x['executionId'])
os.makedirs(x['baseDir']+'/userdata',mode=0o700,exist_ok=False)
shutil.copyfile('/etc/t3code/settings.json',x['baseDir']+'/userdata/settings.json')
with open(root+'/t3.log','wb') as log:
 subprocess.Popen(['/opt/dock-t3-runtime/t3','serve','--host','127.0.0.1','--port','3773','--base-dir',x['baseDir']],cwd=work,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
ready=False
for _ in range(100):
 try:
  response=urllib.request.urlopen('http://127.0.0.1:3773/.well-known/t3/environment',timeout=1)
  if response.status==200:ready=True;break
 except Exception:pass
 time.sleep(.2)
assert ready,'T3 server readiness failed'
subprocess.run(['/opt/dock-t3-runtime/t3','project','add',work,'--base-dir',x['baseDir']],check=True,capture_output=True)
print(json.dumps(dict(executionId=x['executionId'],baseSha=x['baseSha'],worktree=work,baseDir=x['baseDir'],model='agent37/default',policyRootOwned=True,policyReadOnlyToAgent=True)))
PY`
}
