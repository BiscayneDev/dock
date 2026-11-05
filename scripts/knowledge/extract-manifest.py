"""Private exact-manifest source extraction, never initializes a fabricated git pin.
Output stays beside the supplied private input, outside the application repo.
"""
import pathlib,json,sys,re,hashlib,datetime,posixpath,urllib.parse
from graphify.extract import _get_extractor
root=pathlib.Path(sys.argv[1]);inventory=json.loads((root/'source-manifest.json').read_text());nodes=[];edges=[];repos=[]
for key,source in inventory.items():
 sha=source['commit'];base=root/key;files=[];byfile={}
 for info in source['files']:
  path=info['path'];p=base/path;data=p.read_bytes()
  if hashlib.sha256(data).hexdigest()!=info['sha256']:raise Exception('Source bytes changed')
  status='unindexed';reason='Unsupported structural format'
  excluded=p.name.startswith('.env')or p.suffix.lower()in('.db','.sqlite','.sqlite3','.pem','.key','.p12')or any(v in p.parts for v in('node_modules','.git','.gocache','test-ledger'))
  if excluded:status='excluded';reason='Credential/ledger/build path'
  else:
   extractor=_get_extractor(p)
   if extractor:
    try:
     result=extractor(p);valid=set()
     for n in result.get('nodes',[]):
      if n.get('source_file')!=str(p):continue
      nid=hashlib.sha256((key+':'+n['id']).encode()).hexdigest()[:32];valid.add(n['id']);byfile[path]=True;m=re.search(r'\d+',str(n.get('source_location')or''));nodes.append({'id':nid,'repoKey':key,'commit':sha,'path':path,'line':int(m.group())if m else 1,'label':n.get('label',''),'text':n.get('label',''),'provenance':'GRAPHIFY_FILE_AST'})
     for e in result.get('edges',[]):
      if e['source']in valid and e['target']in valid:edges.append({'source':hashlib.sha256((key+':'+e['source']).encode()).hexdigest()[:32],'target':hashlib.sha256((key+':'+e['target']).encode()).hexdigest()[:32],'relation':e.get('relation','structural'),'provenance':'GRAPHIFY_FILE_AST'})
     status='graphify-ast'if path in byfile else'empty-or-skipped';reason='Per-file structural, no cross-file resolution'
    except Exception as e:status='failed';reason=type(e).__name__
   if p.suffix.lower()in('.md','.mdx','.txt','.rst')or p.name in('LICENSE','Dockerfile','Makefile'):
    lines=data.decode().splitlines()
    for i in range(0,len(lines),60):nodes.append({'id':hashlib.sha256((key+':doc:'+path+':'+str(i)).encode()).hexdigest()[:32],'repoKey':key,'commit':sha,'path':path,'line':i+1,'label':path,'text':'\n'.join(lines[i:i+60]),'provenance':'VERBATIM_DOC_CHUNK'})
    status='verbatim-doc';reason='Not semantic extraction'
  files.append({'path':path,'status':status,'reason':reason,'sha256':info['sha256']})
 files +=[{'path':p,'status':'excluded','reason':r}for p,r in source['excluded'].items()]
 repos.append({'key':key,'commit':sha,'currentCommit':sha,'indexedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'coverage':{'trackedFiles':len(files),'archivedTextFiles':len(source['files']),'astFiles':sum(f['status']=='graphify-ast'for f in files),'documentFiles':sum(f['status']=='verbatim-doc'for f in files),'excludedFiles':sum(f['status']=='excluded'for f in files),'unindexedFiles':sum(f['status']in('unindexed','empty-or-skipped','failed')for f in files)},'files':files,'missing':['Per-file structural extraction, not cross-file semantics','Only supplied pinned tracked files; not git history/issues/other branches/outside docs']})
out=root/'snapshot';out.mkdir(exist_ok=True);(out/'graph.json').write_text(json.dumps({'nodes':nodes,'edges':edges},separators=(',',':')));(out/'manifest.json').write_text(json.dumps({'version':1,'repositories':repos},indent=2));print(json.dumps({'nodes':len(nodes),'edges':len(edges),'repositories':[{k:r[k]for k in('key','commit','coverage')}for r in repos]},indent=2))
