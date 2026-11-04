import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {TaskRegistry} from '../src/t3/registry.mjs'
import {buildTaskContext,taskPrompt} from '../src/t3/context.mjs'
import {T3Bridge} from '../src/t3/bridge.mjs'
import {issueContextCapability,permitContext} from '../src/t3/capability.mjs'
const hash=x=>createHash('sha256').update(x).digest('hex')
const scope={ownerId:'owner-a',workspaceId:'ws-a',projectId:'project-a',taskRef:'task-one',executionId:'private-one'}
const fixturePolicy=async(t,s)=>({...s,maxRuntimeMode:'approval-required',loaded:true,fingerprint:'a'.repeat(12)})
const binding={executionId:'private-one',kind:'private-instance',worktree:'/home/node/dock/task-one/work',baseDir:'/home/node/dock-t3/task-one',supervised:true,baseSha:'a'.repeat(40)}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'t3-bridge-'));t.after(()=>rm(dir,{recursive:true,force:true}));const registry=new TaskRegistry(join(dir,'private'));await registry.reserve({...scope,baseSha:'a'.repeat(40),deadlineMs:Date.now()+60000});return{dir,registry}}
test('owner mapping survives restart, fails crossover, prevents execution reuse',async t=>{
 const {dir,registry}=await fixture(t);const fresh=new TaskRegistry(join(dir,'private'));assert.equal((await fresh.get(scope)).state,'reserved')
 for(const k of ['ownerId','workspaceId','projectId','taskRef','executionId'])await assert.rejects(fresh.get({...scope,[k]:'sibling'}),/scope/)
 await assert.rejects(registry.reserve({...scope,taskRef:'task-two',baseSha:'a'.repeat(40),deadlineMs:Date.now()+60000}),/already reserved/)
 assert.equal((await stat(join(dir,'private','tasks.json'))).mode&0o777,0o600)
})
test('durable launch intent prevents duplicate across processes and ambiguous failures',async t=>{
 const {dir,registry}=await fixture(t);let calls=0;const transport=async()=>{calls++;throw new Error('timeout with private details')}
 const input={brief:'fixture',context:{bundle:{sources:[]},sha256:hash(JSON.stringify({sources:[]}))},hostBinding:binding,provider:'pi',model:'fixture/model'}
 await assert.rejects(new T3Bridge({registry,transport}).launch(scope,input),/disabled/);assert.equal(calls,0)
 const bridge=new T3Bridge({registry,transport,enabled:true,policyVerifier:fixturePolicy});await assert.rejects(bridge.launch(scope,input),/uncertain/)
 assert.equal((await registry.get(scope)).state,'uncertain')
 await assert.rejects(new T3Bridge({registry:new TaskRegistry(join(dir,'private')),transport,enabled:true,policyVerifier:fixturePolicy}).launch(scope,input),/unavailable/);assert.equal(calls,1)
})
test('concurrent CAS allows one launch only, lock never stolen',async t=>{
 const {registry,dir}=await fixture(t)
 const outcomes=await Promise.allSettled([registry.transition(scope,1,'launching'),new TaskRegistry(join(dir,'private')).transition(scope,1,'launching')]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
 await mkdir(join(dir,'private','lock'));await assert.rejects(registry.get(scope),/locked/)
})
test('registry rejects symlink file and private directory escape',async t=>{
 const {registry,dir}=await fixture(t);await rm(join(dir,'private','tasks.json'));await writeFile(join(dir,'outside'),'[]',{mode:0o600});await symlink(join(dir,'outside'),join(dir,'private','tasks.json'));await assert.rejects(registry.get(scope))
 await symlink(join(dir,'private'),join(dir,'alias'));await assert.rejects(new TaskRegistry(join(dir,'alias')).get(scope),/unsafe/)
})
test('capability is context-read-only, scoped, expiring and revocable',()=>{
 const {token,record}=issueContextCapability(scope,{now:1000,ttlMs:100})
 assert.equal(permitContext(record,token,scope,'context:read',1050),true)
 for(const k of ['ownerId','workspaceId','projectId','taskRef','executionId'])assert.equal(permitContext(record,token,{...scope,[k]:'sibling'},'context:read',1050),false)
 for(const action of ['thread:start','spend','memory:promote','instance:delete'])assert.equal(permitContext(record,token,scope,action,1050),false)
 assert.equal(permitContext(record,token,scope,'context:read',1100),false);record.revoked=true;assert.equal(permitContext(record,token,scope,'context:read',1050),false)
 assert.equal(JSON.stringify(record).includes(token),false)
})
test('context consumes committed source bytes with hash and explicit allowlist, never dirty/sibling state',async t=>{
 const {dir}=await fixture(t),repo=join(dir,'repo'),knowledge=join(dir,'knowledge');await mkdir(repo);await mkdir(knowledge)
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim()
 git('init','-b','base');await writeFile(join(repo,'policy.md'),'# Budget policy\nFictional budget reference: BRIDGE_SOURCE_CANARY\n');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','fixture');const commit=git('rev-parse','HEAD')
 const bytes=await readFile(join(repo,'policy.md'));const manifest={createdAt:'fixture',files:[{source:'repo/policy.md',commit,sha256:hash(bytes)}]};const graph={dock:{manifestSha256:hash(JSON.stringify(manifest))},nodes:[{label:'budget policy',source_file:'repo/policy.md',source_location:'L1'},{label:'budget sibling secret',source_file:'private/task-two/key.md',source_location:'L1'}]}
 await writeFile(join(knowledge,'manifest.json'),JSON.stringify(manifest));await writeFile(join(knowledge,'graph.json'),JSON.stringify(graph));await writeFile(join(repo,'policy.md'),'DIRTY_PRIVATE_CANARY')
 const args={directory:knowledge,query:'budget',repositories:{repo},allowedSources:['repo/policy.md']};const result=await buildTaskContext(args)
 assert.equal(result.bundle.sources.length,1);assert.match(result.bundle.sources[0].text,/BRIDGE_SOURCE_CANARY/);assert.doesNotMatch(taskPrompt('Read policy',result),/DIRTY_PRIVATE_CANARY|sibling secret/)
 assert.equal((await buildTaskContext({...args,allowedSources:[]})).bundle.sources.length,0)
 manifest.files[0].sha256='0'.repeat(64);graph.dock.manifestSha256=hash(JSON.stringify(manifest));await writeFile(join(knowledge,'manifest.json'),JSON.stringify(manifest));await writeFile(join(knowledge,'graph.json'),JSON.stringify(graph));await assert.rejects(buildTaskContext(args),/hash mismatch/)
})
test('launch stdin really contains source excerpt; exact run result requires review, no auto promotion',async t=>{
 const {registry}=await fixture(t);let submitted
 const bridge=new T3Bridge({registry,enabled:true,policyVerifier:fixturePolicy,transport:async request=>{if(request.args[1]==='start'){submitted=request;return{code:0,stdout:JSON.stringify({threadId:'thread-one',runId:'run-one',baseDir:binding.baseDir})}}return{code:0,stdout:JSON.stringify({thread:{threadId:'thread-one',latestRunId:'run-one',status:'completed',pendingRequestCount:0,runtimeMode:'approval-required'},messages:[{role:'assistant',runId:'run-one',text:'Fixture result'}]})}}})
 const context={bundle:{sources:[{source:'repo/policy.md',text:'BRIDGE_SOURCE_CANARY'}]}};context.sha256=hash(JSON.stringify(context.bundle))
 await bridge.launch(scope,{brief:'Read policy',context,hostBinding:binding,provider:'pi',model:'fixture/model'})
 assert.match(submitted.stdin,/BRIDGE_SOURCE_CANARY/);assert.equal(submitted.args.includes('--wait'),false);assert.equal(submitted.args[3],'-')
 const result=await bridge.observe(scope,{baseDir:binding.baseDir});assert.equal(result.state,'review_required');assert.equal(result.artifact.trusted,false)
 assert.equal((await registry.get(scope)).artifactSha256,result.sha256)
})
test('new phone turn cannot replace mapped run, deadline cleanup remains discoverable',async t=>{
 const {registry}=await fixture(t);await registry.transition(scope,1,'launching');await registry.transition(scope,2,'launched',{threadId:'thread-one',runId:'run-one',baseDir:binding.baseDir})
 const bridge=new T3Bridge({registry,enabled:true,policyVerifier:fixturePolicy,transport:async()=>({code:0,stdout:JSON.stringify({thread:{threadId:'thread-one',latestRunId:'phone-run',status:'completed'},messages:[]})})})
 await assert.rejects(bridge.observe(scope,{baseDir:binding.baseDir}),/correlation/)
 assert.equal((await registry.due(Date.now()+120000)).length,1)
 await registry.transition(scope,3,'cleanup_due');await registry.transition(scope,4,'deleted');assert.equal((await registry.due(Date.now()+120000)).length,0)
})

test('context service refuses sibling credential before any source read',async t=>{
 const {registry}=await fixture(t);const {readScopedContext}=await import('../src/t3/context-service.mjs');const {token,record:capability}=issueContextCapability({...scope,taskRef:'task-sibling'})
 await assert.rejects(readScopedContext({registry,capability,token,scope,sourceConfig:{directory:'/must-not-read'},query:'budget'}),/capability refused/)
})
test('cleanup verifies missing state after uncertain delete, no duplicate delete on recovery',async t=>{
 const {registry}=await fixture(t);const {cleanupExecution}=await import('../src/t3/cleanup.mjs');let present=true,calls=0
 const options={registry,scope,readExecution:async()=>present?'present':'absent',deleteExecution:async()=>{calls++;present=false;throw new Error('response lost')}}
 assert.equal((await cleanupExecution(options)).state,'deleted');assert.equal((await cleanupExecution(options)).state,'deleted');assert.equal(calls,1)
})
test('cleanup failure retains responsibility, due launching is recoverable',async t=>{
 const {registry}=await fixture(t);await registry.transition(scope,1,'launching');const {cleanupExecution}=await import('../src/t3/cleanup.mjs')
 await assert.rejects(cleanupExecution({registry,scope,readExecution:async()=>'unknown',deleteExecution:async()=>assert.fail()}),/unverified/)
 assert.equal((await registry.get(scope)).state,'cleanup_due')
})
test('local transport refuses another execution before spawn',async()=>{
 const {localCliTransport}=await import('../src/t3/local-cli.mjs')
 await assert.rejects(localCliTransport({binary:'/must-not-execute',home:'/tmp',enabled:true,executionId:'task-a'})({executionId:'task-b',args:[],stdin:''}),/transport mismatch/)
})
test('launch refuses unmanaged, full-access, unknown or stale policy BEFORE starting',async t=>{
 const {registry}=await fixture(t);let starts=0
 for(const stdout of ['No managed policy on this machine. Every setting belongs to the user.', 'Managed by Dock (/etc/t3code/policy.json, fingerprint aaaaaaaaaaaa).\nLimits:\n{"maxRuntimeMode":"full-access"}\nThe running server loaded this policy.', 'Managed by Dock (/etc/t3code/policy.json, fingerprint aaaaaaaaaaaa).\nLimits:\n{"maxRuntimeMode":"approval-required"}\nRestart T3 Code to apply the installed policy.']){
 const transport=async r=>{if(r.args[0]==='thread'){starts++;throw new Error('must not launch')}return{code:0,stdout}}
 const bridge=new T3Bridge({registry,transport,enabled:true})
 await assert.rejects(bridge.launch(scope,{brief:'fixture',context:{bundle:{sources:[]},sha256:hash(JSON.stringify({sources:[]}))},hostBinding:binding,provider:'pi',model:'fixture/model'}),/policy/)
 assert.equal((await registry.get(scope)).state,'reserved')
 }assert.equal(starts,0)
})
test('matching installed and running supervised ceiling passes preflight',async()=>{
 const {verifySupervisedPolicy}=await import('../src/t3/policy.mjs')
 const evidence=await verifySupervisedPolicy(async()=>({code:0,stdout:'Managed by Dock (/etc/t3code/policy.json, fingerprint aaaaaaaaaaaa).\nLimits:\n{"maxRuntimeMode":"approval-required"}\nThe running server (pid 12) loaded this policy.'}),{executionId:'private-one',baseDir:binding.baseDir})
 assert.equal(evidence.loaded,true);assert.equal(evidence.maxRuntimeMode,'approval-required')
})
