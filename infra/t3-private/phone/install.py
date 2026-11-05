# Fixed owner restoration setup, default node only. Invoke after runtime repair.
# No arbitrary remote scripts, credentials or management calls.
import os,pathlib,shutil,stat,json
assert os.getuid()!=0
root=pathlib.Path('/home/node/dock-phone')
root.mkdir(mode=0o700,exist_ok=True)
base=root/'t3'; (base/'userdata').mkdir(parents=True,mode=0o700,exist_ok=True)
policy=pathlib.Path('/etc/t3code/policy.json');s=policy.stat()
assert s.st_uid==0 and stat.S_ISREG(s.st_mode) and not os.access(policy,os.W_OK)
assert json.loads(policy.read_text())['limits']['maxRuntimeMode']=='approval-required'
settings=base/'userdata/settings.json'
if not settings.exists():shutil.copyfile('/etc/t3code/settings.json',settings)
# Scripts are uploaded as fixed reviewed files before invocation.
for name in ['start.sh','post-restart.sh']:
 p=root/name;s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid()
 p.chmod(0o700)
hooks=pathlib.Path('/home/node/.agent37/hooks');hooks.mkdir(parents=True,exist_ok=True)
target=hooks/'post-restart.sh'
if target.exists():
 text=target.read_text()
 # Never overwrite an active unrelated recovery hook.
 assert not any(line.strip() and not line.startswith('#') for line in text.splitlines()) or text==(root/'post-restart.sh').read_text()
shutil.copyfile(root/'post-restart.sh',target);target.chmod(0o700)
print('PHONE_RESTART_HOOK_INSTALLED_NONROOT')
