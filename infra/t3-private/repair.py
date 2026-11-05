# Fixed owner-admin operation only. Run through Agent37 exec user=root before
# handing an instance to any task. No caller/model parameters or account keys.
import os,pathlib,stat,subprocess
assert os.getuid()==0, 'owner admin repair requires root'
root=pathlib.Path('/opt/dock-t3-runtime')
assert root.is_dir() and not root.is_symlink() and root.stat().st_uid==0
# Installer tar can preserve archive UIDs on nested files. Verify every link
# stays inside this fixed runtime, then take root ownership without dereferencing.
paths=[root,*root.rglob('*')]
for p in paths:
 s=p.lstat()
 if stat.S_ISLNK(s.st_mode):
  assert p.resolve().is_relative_to(root), 'runtime symlink leaves fixed root'
 else:
  assert stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode), 'unexpected runtime type'
subprocess.run(['chown','-hR','root:root',str(root)],check=True)
subprocess.run(['chmod','-R','a+rX,a-w',str(root)],check=True)
assert all(p.lstat().st_uid==0 for p in paths)
print('OWNER_ADMIN_RUNTIME_REPAIR_OK')
