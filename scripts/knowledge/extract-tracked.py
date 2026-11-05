"""Resumable local Graphify per-file structural extraction, no model calls.
No cross-file resolution is claimed by this pass. Never executes repo code.
Outputs are private external files, not a source/public fixture.
"""
import pathlib,subprocess,json,sys,time,hashlib
from graphify.extract import _get_extractor
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);deadline=time.monotonic()+float(sys.argv[3]if len(sys.argv)>3 else 25);n=0
for repo in sorted((root/'repos').iterdir()):
 sha=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD']).decode().strip();dest=out/repo.name/sha;dest.mkdir(parents=True,exist_ok=True)
 files=subprocess.check_output(['git','-C',str(repo),'ls-tree','-r','--name-only',sha]).decode().splitlines()
 for name in files:
  key=hashlib.sha256(name.encode()).hexdigest();target=dest/(key+'.json')
  if target.exists():continue
  if time.monotonic()>deadline:print(json.dumps({'processedThisPass':n,'more':True}));sys.exit()
  p=repo/name;item={'path':name,'commit':sha,'nodes':[],'edges':[]}
  if not p.is_file()or p.is_symlink()or any(x in p.parts for x in('.git','node_modules','.gocache','.cache','dist','build','test-ledger'))or p.name.startswith('.env')or p.suffix in('.db','.pem','.key','.p12'):item['status']='excluded-sensitive-or-nonregular'
  elif p.stat().st_size>2*1024*1024:item['status']='excluded-large'
  else:
   extractor=_get_extractor(p)
   if not extractor:item['status']='unsupported'
   else:
    try:
     result=extractor(p);item.update(nodes=result.get('nodes',[]),edges=result.get('edges',[]),status='structural-per-file'if result.get('nodes')else'empty-or-skipped',error=result.get('error'))
     for node in item['nodes']:
      source=node.get('source_file','')
      try:node['source_file']=str(pathlib.Path(source).relative_to(repo))if source else''
      except ValueError:node['source_file']=''
    except Exception as e:item.update(status='failed',error=type(e).__name__)
  target.write_text(json.dumps(item));n+=1
print(json.dumps({'processedThisPass':n,'more':False}))
