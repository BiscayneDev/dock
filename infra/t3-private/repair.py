# Fixed owner-admin operation only. Run through Agent37 exec user=root before
# handing an instance to any task. No caller/model parameters or account keys.
import os,pathlib,stat
assert os.getuid()==0, 'owner admin repair requires root'
root=pathlib.Path('/opt/dock-t3-runtime')
for p in [root,*root.rglob('*')]:
 s=p.lstat()
 assert s.st_uid==0, 'unexpected runtime owner'
 assert not stat.S_ISLNK(s.st_mode), 'unexpected runtime symlink'
 assert stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode), 'unexpected runtime type'
 mode=s.st_mode&0o777
 p.chmod((mode|0o444|(0o111 if stat.S_ISDIR(s.st_mode) or mode&0o111 else 0))&~0o222)
print('OWNER_ADMIN_RUNTIME_REPAIR_OK')
