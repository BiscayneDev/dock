"""Graphify two-pass structural resolution over a verified private text manifest.
Local AST only, no model calls, repo execution or source publication.
"""
import pathlib,json,hashlib,re,sys
from graphify.extract import extract,_get_extractor
root=pathlib.Path(sys.argv[1]);inventory=json.loads((root/'source-manifest.json').read_text());nodes=[];edges=[];reports=[]
for key,source in inventory.items():
 base=root/key;paths=[]
 for info in source['files']:
  p=base/info['path'];data=p.read_bytes()
  if hashlib.sha256(data).hexdigest()!=info['sha256']:raise Exception('Source changed')
  if p.name.startswith('.env')or p.suffix.lower()in('.db','.sqlite','.pem','.key','.p12')or any(v in p.parts for v in('node_modules','.git','.gocache','test-ledger')):continue
  if _get_extractor(p):paths.append(p)
 result=extract(paths,cache_root=root/'ast-cache'/key,root=base,parallel=False);valid={}
 for n in result['nodes']:
  path=n.get('source_file','');p=pathlib.Path(path)
  if p.is_absolute():
   try:path=str(p.relative_to(base))
   except ValueError:continue
  if path not in{f['path']for f in source['files']}:continue
  nid=hashlib.sha256((key+':resolved:'+n['id']).encode()).hexdigest()[:32];valid[n['id']]=nid;m=re.search(r'\d+',str(n.get('source_location')or''));nodes.append({'id':nid,'repoKey':key,'commit':source['commit'],'path':path,'line':int(m.group())if m else 1,'label':n.get('label',''),'text':n.get('label',''),'provenance':'GRAPHIFY_RESOLVED_AST'})
 count=0
 for e in result.get('edges',result.get('links',[])):
  if e['source']in valid and e['target']in valid:edges.append({'source':valid[e['source']],'target':valid[e['target']],'relation':e.get('relation','structural'),'provenance':'GRAPHIFY_RESOLVED_AST','confidence':e.get('confidence','INFERRED')});count+=1
 reports.append({'key':key,'filesAttempted':len(paths),'nodes':len(valid),'edges':count,'failedSources':result.get('failed_sources',[])})
(root/'resolved-graph.json').write_text(json.dumps({'nodes':nodes,'edges':edges},separators=(',',':')));print(json.dumps(reports,indent=2))
