"""Resumable two-pass Graphify by committed package unit, local AST only.
A package boundary is a resolver boundary; never claim global semantic coverage.
"""
import pathlib,json,subprocess,sys,time,hashlib,re
from graphify.extract import extract,_get_extractor
root=pathlib.Path(sys.argv[1]);deadline=time.monotonic()+float(sys.argv[2]if len(sys.argv)>2 else 30);out=root/'resolved-units';out.mkdir(exist_ok=True)
for repo in sorted((root/'repos').iterdir()):
 sha=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD']).decode().strip();files=subprocess.check_output(['git','-C',str(repo),'ls-tree','-r','--name-only',sha]).decode().splitlines();units={}
 for path in files:
  p=repo/path
  if not p.is_file()or p.is_symlink()or p.name.startswith('.env')or p.suffix in('.db','.sqlite','.pem','.key','.p12')or any(v in p.parts for v in('node_modules','.git','.gocache','.cache','dist','build','test-ledger'))or p.stat().st_size>2*1024*1024:continue
  if not _get_extractor(p):continue
  # Large CLI library naturally contains one independently declared package
  # per service. Resolve within each, not all services in a giant global scope.
  parts=pathlib.PurePosixPath(path).parts
  unit='/'.join(parts[:3])if repo.name=='shipyard-cli-library'and parts[0]=='library'and len(parts)>3 else'.'
  units.setdefault(unit,[]).append(p)
 for unit,paths in sorted(units.items()):
  dest=out/repo.name/sha;dest.mkdir(parents=True,exist_ok=True);target=dest/(hashlib.sha256(unit.encode()).hexdigest()+'.json')
  if target.exists():continue
  if time.monotonic()>deadline:print('RESUME_REQUIRED');sys.exit()
  result=extract(paths,cache_root=root/'resolved-cache'/repo.name/hashlib.sha256(unit.encode()).hexdigest(),root=repo,parallel=False);target.write_text(json.dumps({'unit':unit,'commit':sha,'files':[str(p.relative_to(repo))for p in paths],'graph':result}));print(repo.name,unit,len(paths),flush=True)
print('RESOLVED_UNITS_COMPLETE')
