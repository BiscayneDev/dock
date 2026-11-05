# Build-time test, run as final USER node. No model calls or instance credentials.
import os,pathlib,subprocess,tempfile,time,urllib.request,shutil
assert os.getuid()!=0, 'smoke test must run as non-root'
for path in ['/etc/t3code/policy.json','/opt/dock-t3-runtime']:
 assert os.stat(path).st_uid==0 and not os.access(path,os.W_OK), path
for p in pathlib.Path('/opt/dock-t3-runtime').rglob('*'):
 assert p.lstat().st_uid==0, 'runtime child must be root owned: '+str(p)
 assert not os.access(p,os.W_OK), 'runtime child writable: '+str(p)
root=tempfile.mkdtemp(prefix='dock-image-smoke-')
server=None
try:
 subprocess.run(['/opt/dock-t3-runtime/t3','--version'],check=True)
 with open(root+'/server.log','wb') as log:
  server=subprocess.Popen(['/opt/dock-t3-runtime/t3','serve','--host','127.0.0.1','--port','3773','--base-dir',root+'/state'],stdin=subprocess.DEVNULL,stdout=log,stderr=log)
 ready=False
 for _ in range(100):
  if server.poll() is not None:break
  try:
   with urllib.request.urlopen('http://127.0.0.1:3773/.well-known/t3/environment',timeout=1) as r:ready=r.status==200
   if ready:break
  except Exception:pass
  time.sleep(.2)
 assert ready, pathlib.Path(root+'/server.log').read_text()
 policy=subprocess.check_output(['/opt/dock-t3-runtime/t3','policy','show','--base-dir',root+'/state'],text=True)
 assert 'loaded this policy.' in policy and '"maxRuntimeMode": "approval-required"' in policy, policy
 assert not shutil.which('sudo')
 print('NONROOT_STARTUP_MANAGED_POLICY_OK')
finally:
 if server is not None:
  server.terminate()
  try:server.wait(timeout=10)
  except subprocess.TimeoutExpired:server.kill();server.wait()
 shutil.rmtree(root)
