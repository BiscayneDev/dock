"""Fail-closed source-only publication audit. Inspect findings before publication.
This checks the entire introduced tree, not only a working-directory diff.
"""
import subprocess,pathlib,re,sys
base=sys.argv[1] if len(sys.argv)>1 else '6eecc1137ccb8649fff11f185f49a0ccc23a500b'
paths=set(subprocess.check_output(['git','diff','--name-only',base]).decode().splitlines())
paths.update(subprocess.check_output(['git','ls-files','--others','--exclude-standard']).decode().splitlines())
findings=[]
for name in sorted(paths):
 p=pathlib.Path(name)
 if not p.exists():continue
 if p.is_symlink()or not p.is_file():findings.append((name,'non-regular source'));continue
 if any(x in p.parts for x in('__pycache__','node_modules','.next'))or p.suffix in('.pyc','.png','.jpg','.pdf','.tar','.gz','.zip','.log')or p.name in('graph.json','manifest.json','source-manifest.json')or p.name.startswith('.env'):findings.append((name,'generated/private artifact'));continue
 try:text=p.read_text()
 except UnicodeError:findings.append((name,'binary content'));continue
 # Build patterns in pieces so the auditor itself is not a false positive.
 patterns=['github'+'_pat_[A-Za-z0-9_]+','gh'+'p_[A-Za-z0-9]{20,}','sk'+'-[A-Za-z0-9]{20,}','BEGIN '+'[A-Z ]*PRIVATE KEY','eyJh'+'bGci[A-Za-z0-9_-]+','/(?:down'+'loads|obser'+'vations)/','(?:agent|chat|phone'+'msg)-01[A-Z0-9]+']
 if any(re.search(pattern,text,re.I)for pattern in patterns):findings.append((name,'credential/private-path shape'))
print('Source paths checked:',len(paths))
for name,reason in findings:print(reason+': '+name)
if findings:sys.exit(1)
print('PASS: no blocked generated artifacts or credential/private-path shapes. Manual content review remains required.')
