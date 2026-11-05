"""Local Graphify normalization + full tracked-file coverage, no semantic API.
Private outputs stay outside repository. Docs are verbatim line chunks, not
misrepresented as semantic extraction. Cross-repo edges are explicit manifest
package dependencies only, not invented architecture relations.
"""
import pathlib,json,subprocess,hashlib,datetime,re,sys,posixpath,urllib.parse
root=pathlib.Path(sys.argv[1]);nodes=[];edges=[];repos=[];packages={};dependencies=[]
def git(p,*a):return subprocess.check_output(['git','-C',str(p),*a]).decode().strip()
for repo in sorted((root/'repos').iterdir()):
 key=repo.name;sha=git(repo,'rev-parse','HEAD');files=git(repo,'ls-tree','-r','--name-only',sha).splitlines();g=root/'extracted'/key/'graphify-out/graph.json';prefix=''
 if key=='shipyard-inference':g=root/'extracted/shipyard-inference-src/graphify-out/graph.json';prefix='src/'
 coverage=[];byfile={};rn=key+':repository';nodes.append({'id':rn,'repoKey':key,'commit':sha,'label':key,'path':'README.md','line':1,'text':'Repository '+key,'provenance':'COMMITTED_MANIFEST'})
 if g.exists():
  raw=json.loads(g.read_text());valid=set()
  for n in raw['nodes']:
   path=prefix+n.get('source_file','');m=re.search(r'\d+',str(n.get('source_location')or''));line=int(m.group())if m else 1
   if path not in files:continue
   nid=key+':'+n['id'];valid.add(n['id']);byfile[path]=byfile.get(path,0)+1;nodes.append({'id':nid,'repoKey':key,'commit':sha,'label':n.get('label'), 'path':path,'line':line,'text':n.get('label',''),'provenance':'GRAPHIFY_AST'})
  for e in raw.get('links',raw.get('edges',[])):
   if e['source']in valid and e['target']in valid:edges.append({**e,'source':key+':'+e['source'],'target':key+':'+e['target']})
 # Supplemental resumable Graphify file pass. Edges are per-file structural,
 # not cross-file semantic resolution. Keep that provenance distinct.
 supplemental=root/'tracked-extraction'/key/sha
 attempts={}
 existing={n['id'] for n in nodes}
 for result in sorted(supplemental.glob('*.json')):
  item=json.loads(result.read_text());path=item['path']
  if path not in files or item.get('commit')!=sha:continue
  attempts[path]=item['status'];valid=set()
  for n in item.get('nodes',[]):
   if n.get('source_file')!=path:continue
   nid=key+':file-ast:'+n['id'];valid.add(n['id']);m=re.search(r'\d+',str(n.get('source_location')or''));line=int(m.group())if m else 1
   if nid in existing:continue
   existing.add(nid);byfile[path]=byfile.get(path,0)+1
   nodes.append({'id':nid,'repoKey':key,'commit':sha,'label':n.get('label'),'path':path,'line':line,'text':n.get('label',''),'provenance':'GRAPHIFY_FILE_AST'})
  for e in item.get('edges',[]):
   if e['source']in valid and e['target']in valid:edges.append({**e,'source':key+':file-ast:'+e['source'],'target':key+':file-ast:'+e['target'],'provenance':'GRAPHIFY_FILE_AST'})
 for f in files:
  p=repo/f;status='graphify-ast'if f in byfile else'not-ast-indexed';reason=''
  if status=='not-ast-indexed'and attempts.get(f,'').startswith('excluded'):status='excluded';reason=attempts[f]
  excluded=any(v in pathlib.PurePosixPath(f).parts for v in('.git','node_modules','.gocache','.cache','dist','build','test-ledger'))or p.name.startswith('.env')or p.suffix.lower()in('.db','.sqlite','.sqlite3','.pem','.key','.p12')
  if excluded:status='excluded';reason='Build/cache/ledger/credential path, never source knowledge'
  text_source=p.suffix.lower()in('.md','.mdx','.txt','.rst','.tmpl','.graphql','.gql','.toml','.ini','.css','.html')or p.name in('LICENSE','NOTICE','Makefile','Dockerfile','go.mod','.gitignore')
  if not excluded and text_source and not f.startswith('vendor/')and p.is_file()and not p.is_symlink():
   try:
    text=p.read_text();lines=text.splitlines()
    if len(text)>1024*1024:raise ValueError('large document')
    for i in range(0,len(lines),60):
     nid=key+':doc:'+f+':'+str(i+1);nodes.append({'id':nid,'repoKey':key,'commit':sha,'label':f,'path':f,'line':i+1,'text':'\n'.join(lines[i:i+60]),'provenance':'VERBATIM_DOC_CHUNK'});edges.append({'source':rn,'target':nid,'relation':'contains-document'})
    status='verbatim-doc'if p.suffix.lower()in('.md','.mdx','.txt','.rst')else'verbatim-template-config';reason='No semantic extraction'
   except Exception as e:status='excluded';reason=str(e)
  if f.endswith('package.json')and'node_modules/'not in f:
   try:
    package=json.loads(p.read_text());name=package.get('name');
    if name:packages[name]=rn
    dependencies.extend((rn,d)for d in package.get('dependencies',{}))
   except:pass
  if status=='not-ast-indexed':reason=attempts.get(f,'No Graphify symbols, unsupported format, or extraction incomplete')
  coverage.append({'path':f,'status':status,'reason':reason})
 repos.append({'key':key,'commit':sha,'currentCommit':git(repo,'ls-remote','origin','HEAD').split()[0],'indexedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'coverage':{'trackedFiles':len(files),'astFiles':sum(x['status']=='graphify-ast'for x in coverage),'astFilesIncludingDocs':len(byfile),'excludedFiles':sum(x['status']=='excluded'for x in coverage),'structuralAttempts':len(attempts),'documentFiles':sum(x['status']=='verbatim-doc'for x in coverage),'templateConfigFiles':sum(x['status']=='verbatim-template-config'for x in coverage),'unindexedFiles':sum(x['status']=='not-ast-indexed'for x in coverage)},'missing':['Per-file supplemental AST lacks cross-file resolution; docs chunks are not semantic relations','Non-repository docs inventory may be incomplete'],'files':coverage})
for source,name in dependencies:
 if name in packages and packages[name]!=source:edges.append({'source':source,'target':packages[name],'relation':'declared-package-dependency','package':name,'provenance':'PACKAGE_JSON'})
# Exact relative markdown links are document relationships with observable
# evidence, not model-inferred semantics. Target must be a committed indexed file.
file_nodes={}
for n in nodes:file_nodes.setdefault((n['repoKey'],n['path']),n['id'])
doc_links=0
for n in list(nodes):
 if n.get('provenance')!='VERBATIM_DOC_CHUNK':continue
 for match in re.finditer(r'\[[^\]]*\]\(([^)\s]+)(?:[^)]*)\)',n.get('text','')):
  url=urllib.parse.urlparse(match.group(1))
  if url.scheme or url.netloc or not url.path or url.path.startswith('/'):continue
  target=posixpath.normpath(posixpath.join(posixpath.dirname(n['path']),urllib.parse.unquote(url.path)))
  if target.startswith('../'):continue
  key=(n['repoKey'],target)
  if key in file_nodes and file_nodes[key]!=n['id']:
   edges.append({'source':n['id'],'target':file_nodes[key],'relation':'document-relative-link','provenance':'EXPLICIT_COMMITTED_MARKDOWN_LINK'});doc_links+=1
# Coverage exclusions are also enforced in graph payload, not merely labeled.
excluded_paths={(r['key'],f['path'])for r in repos for f in r['files']if f['status']=='excluded'}
nodes=[n for n in nodes if(n['repoKey'],n['path'])not in excluded_paths]
valid_ids={n['id']for n in nodes};edges=[e for e in edges if e['source']in valid_ids and e['target']in valid_ids]
# Compact deterministic graph identifiers avoid repeating long absolute-derived
# Graphify names on every edge. Source commit/path/line remain verbatim.
idmap={n['id']:hashlib.sha256(n['id'].encode()).hexdigest()[:32]for n in nodes}
for n in nodes:n['id']=idmap[n['id']]
for e in edges:
 e['source']=idmap[e['source']];e['target']=idmap[e['target']]
edges=[{k:e[k]for k in('source','target','relation','provenance','confidence','confidence_score','package')if k in e}for e in edges]
out=root/'snapshot';out.mkdir(exist_ok=True);(out/'graph.json').write_text(json.dumps({'nodes':nodes,'edges':edges},separators=(',',':')));(out/'manifest.json').write_text(json.dumps({'version':1,'engine':'graphifyy 0.9.102 local AST; verbatim docs','repositories':repos},indent=2));print(json.dumps({'repositories':len(repos),'nodes':len(nodes),'edges':len(edges),'explicitDocumentLinks':doc_links,'coverage':[{k:r[k]for k in('key','commit','coverage')}for r in repos]},indent=2))
