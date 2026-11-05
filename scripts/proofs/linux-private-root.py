"""Local Linux containment negative proof, not a remote image qualification.
Uses fresh user/mount/pid/network namespaces, private root, no capabilities,
no-new-privileges and no inherited credentials. No external requests.
"""
import tempfile,pathlib,subprocess,json,concurrent.futures,os,socket,threading,shutil
# Optional local functional relay proof. No external model/vendor requests.
relay_mode=os.environ.get('DOCK_PROVE_SCOPED_RELAY')=='1'
relay_calls=[];relay_threads=[];relay_errors=[]
root=pathlib.Path(tempfile.mkdtemp(prefix='dock-ns-proof-'));outside=root/'controller-secret';outside.write_text('fictional-controller-only')
for name in ['one','two']:
 task=root/name;task.mkdir();(task/'work').mkdir();(task/'work'/'source.txt').write_text('shared-source')
 def git(*args):return subprocess.check_output(['git','-C',str(task/'work'),*args],stderr=subprocess.DEVNULL,text=True).strip()
 git('init','-b','main');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','base')
 (task/'private-marker').write_text(name+' private');(task/'root').mkdir()
 if relay_mode:
  relay=task/'relay';relay.mkdir();server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(str(relay/'model.sock'));server.listen(2);server.settimeout(15)
  def serve(name=name,server=server):
   try:
    # One exact fixed scope, then one deliberate substitution attempt.
    for _ in range(2):
     conn,_=server.accept()
     with conn:
      request=json.loads(conn.recv(4096))
      accepted=request=={'execution':name,'prompt':'fictional scoped model request'}
      if accepted:relay_calls.append(name)
      conn.sendall(json.dumps({'ok':accepted,'text':name+' fictional model answer'if accepted else ''}).encode())
   except Exception as e:relay_errors.append(str(e))
   finally:server.close()
  thread=threading.Thread(target=serve);thread.start();relay_threads.append(thread)
probe="""import os,json,socket,pathlib,subprocess,time
x=json.load(open('/case.json'))
for path in x['forbidden']:
 try:open(path).read();raise RuntimeError('Boundary breached')
 except (FileNotFoundError,PermissionError):pass
assert pathlib.Path('/private-marker').read_text()==x['name']+' private'
assert pathlib.Path('/task/source.txt').read_text()=='shared-source'
pathlib.Path('/task/own-change').write_text(x['name'])
status=pathlib.Path('/proc/self/status').read_text()
assert 'CapEff:\\t0000000000000000' in status and 'NoNewPrivs:\\t1' in status
try:socket.create_connection(('1.1.1.1',443),timeout=.2);raise RuntimeError('Unexpected network')
except OSError:pass
if x['relay']:
 def model(request):
  s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect('/relay/model.sock');s.sendall(json.dumps(request).encode());value=json.loads(s.recv(4096));s.close();return value
 good=model({'execution':x['name'],'prompt':'fictional scoped model request'})
 assert good=={'ok':True,'text':x['name']+' fictional model answer'}
 denied=model({'execution':'sibling','prompt':'fictional scoped model request','url':'https://forbidden.invalid'})
 assert denied=={'ok':False,'text':''}
 assert not pathlib.Path('/sibling-relay/model.sock').exists()
assert subprocess.run(['mount' ,'-t','tmpfs','tmpfs','/tmp'],capture_output=True).returncode!=0
print(json.dumps(dict(name=x['name'],scopedRelayWorking=x['relay'],relayScopeSubstitutionRefused=x['relay'],privateRoot=True,networkBlocked=True,noCapabilities=True,noNewPrivileges=True,hostAndSiblingAbsent=True,namespaces={k:os.readlink('/proc/self/ns/'+k)for k in ['mnt','pid','net','user']})),flush=True)
time.sleep(1)
"""
for name in ['one','two']:
 task=root/name;(task/'probe.py').write_text(probe)
 (task/'case.json').write_text(json.dumps({'name':name,'relay':relay_mode,'forbidden':[str(outside),str(root/('two'if name=='one'else'one')/'private-marker'),'/proc/1/root'+str(outside),'/controller/credentials','/sibling/private-state','/task/.git/objects/info/alternates']}))
script="""set -eu
mount --make-rprivate /
root="$1/root"
mount -t tmpfs tmpfs "$root"
mkdir -p "$root/usr" "$root/bin" "$root/lib" "$root/lib64" "$root/proc" "$root/tmp" "$root/task"
for p in usr bin lib lib64; do mount --bind "/$p" "$root/$p";mount -o remount,bind,ro "$root/$p";done
mount --bind "$1/work" "$root/task"
if [ -d "$1/relay" ];then mkdir -p "$root/relay";mount --bind "$1/relay" "$root/relay";mount -o remount,bind,ro "$root/relay";fi
for f in probe.py case.json private-marker;do touch "$root/$f";mount --bind "$1/$f" "$root/$f";mount -o remount,bind,ro "$root/$f";done
mount -t proc proc "$root/proc"
chroot "$root" /usr/bin/setpriv --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp /usr/bin/python3 /probe.py
"""
def run(name):
 r=subprocess.run(['unshare','--user','--map-root-user','--mount','--pid','--fork','--net','sh','-c',script,'fixture',str(root/name)],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout)
with concurrent.futures.ThreadPoolExecutor(2)as pool:results=list(pool.map(run,['one','two']))
for key in ['mnt','pid','net','user']:assert results[0]['namespaces'][key]!=results[1]['namespaces'][key]
assert(root/'one/work/own-change').read_text()=='one'and(root/'two/work/own-change').read_text()=='two'
for thread in relay_threads:thread.join(20)
assert not relay_errors,relay_errors
if relay_mode:assert sorted(relay_calls)==['one','two']
print(json.dumps({'localLinuxOnly':True,'twoConcurrentPrivateRoots':results,'siblingWritesIndependent':True,'remoteRuntimeQualified':False,'scopedModelRelayLocallyProved':relay_mode,'externalModelEgressQualified':False,'watchdogDeployed':False}))

shutil.rmtree(root)
