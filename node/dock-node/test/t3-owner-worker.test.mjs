import {test}from'node:test'
import assert from'node:assert/strict'
import {T3OwnerWorker}from'../src/t3/worker.mjs'
import {agent37Provisioner}from'../src/t3/agent37.mjs'
const policy='Managed by Dock (/etc/t3code/policy.json, fingerprint aaaaaaaaaaaa).\nLimits:\n{"maxRuntimeMode":"approval-required"}\nThe running server loaded this policy.'
function fixture(overrides={}){
 let row={id:'11111111-1111-4111-8111-111111111111',owner_id:'owner',workspace_id:'workspace',project_id:'project',repo_key:'fixture',base_sha:'a'.repeat(40),brief:'Fictional task',phase:'queued',version:1,cleanup_deadline:new Date(Date.now()+60000).toISOString()},instances=[],calls=[]
 const store={get:async()=>structuredClone(row),claim:async(id,w)=>{if(row.phase!=='queued')return null;row={...row,phase:'provisioning',version:2,worker:w};return structuredClone(row)},advance:async(t,next,patch={})=>{assert.equal(t.version,row.version);assert.equal(t.worker,row.worker);row={...row,phase:next,version:row.version+1,...patch};return structuredClone(row)},heartbeat:async()=>true,due:async()=>[{id:row.id}],takeCleanup:async()=>{row={...row,phase:'cleanup_due',worker:'t3:watchdog',version:row.version+1};return structuredClone(row)}}
 const provisioner={create:async({name})=>{instances=[{id:'fixtureinstance',name}];return{id:'fixtureinstance'}},prepare:async({task})=>({executionId:task.execution_id,baseSha:task.base_sha,worktree:'/home/node/dock/task/work',baseDir:'/home/node/dock-t3',model:'fixture/model'}),cli:async r=>{calls.push(r);if(r.args[0]==='policy')return{code:0,stdout:policy};if(r.args[1]==='start')return{code:0,stdout:JSON.stringify({threadId:'thread-one',runId:'run-one'})};return{code:0,stdout:JSON.stringify({thread:{threadId:'thread-one',latestRunId:'run-one',runtimeMode:'approval-required',status:'completed',pendingRequestCount:0},messages:[{role:'assistant',runId:'run-one',text:'Fixture stored result'}]})}},find:async()=>instances,delete:async()=>{instances=[]},settled:async()=>true,...overrides}
 return{store,provisioner,calls,get row(){return row},get instances(){return instances}}
}
test('one owner task becomes stored review result and instance is deleted',async()=>{
 const f=fixture(),worker=new T3OwnerWorker({...f,authority:async()=>true,enabled:true});const result=await worker.run(f.row.id,'t3:fixture')
 assert.equal(result.phase,'deleted');assert.deepEqual(result.artifact.messages,['Fixture stored result']);assert.equal(result.artifact.trusted,false);assert.equal(f.instances.length,0)
 assert.equal(f.calls[0].args[0],'policy');assert.equal(f.calls[1].stdin,'Fictional task');assert.equal(f.calls[1].args.includes('--wait'),false)
})
test('disabled and missing authority cannot create compute',async()=>{
 const f=fixture();let creates=0;f.provisioner.create=async()=>{creates++;throw new Error()}
 await assert.rejects(new T3OwnerWorker({...f,authority:async()=>true}).run(f.row.id,'t3:w'),/disabled/)
 await assert.rejects(new T3OwnerWorker({...f,enabled:true,authority:async()=>false}).run(f.row.id,'t3:w'),/authority/);assert.equal(creates,0)
})
test('policy refusal happens before launch, then deletes private instance',async()=>{
 let starts=0;const f=fixture({cli:async r=>{if(r.args[0]==='thread')starts++;return{code:0,stdout:'No managed policy'}}})
 await new T3OwnerWorker({...f,authority:async()=>true,enabled:true}).run(f.row.id,'t3:w');assert.equal(starts,0);assert.equal(f.row.phase,'deleted');assert.equal(f.row.artifact,undefined)
})
test('lost create response is found by stable task name and deleted, never retried',async()=>{
 const f=fixture();const create=f.provisioner.create;let creates=0;f.provisioner.create=async x=>{creates++;await create(x);throw new Error('lost response')}
 await new T3OwnerWorker({...f,authority:async()=>true,enabled:true}).run(f.row.id,'t3:w');assert.equal(creates,1);assert.equal(f.instances.length,0);assert.equal(f.row.phase,'deleted')
})
test('lost delete response reconciles absent state, unreconciled deletion stays due',async()=>{
 const f=fixture();const del=f.provisioner.delete;f.provisioner.delete=async()=>{await del();throw new Error('lost response')}
 await new T3OwnerWorker({...f,authority:async()=>true,enabled:true}).run(f.row.id,'t3:w');assert.equal(f.row.phase,'deleted')
 const g=fixture({delete:async()=>{throw new Error('no delete')}});await assert.rejects(new T3OwnerWorker({...g,authority:async()=>true,enabled:true}).run(g.row.id,'t3:w'),/unverified/);assert.equal(g.row.phase,'cleanup_due')
})
test('different phone run never becomes original owner task result',async()=>{
 const f=fixture();const cli=f.provisioner.cli;f.provisioner.cli=async r=>{const x=await cli(r);if(r.args[0]==='thread'&&r.args[1]==='show'){const d=JSON.parse(x.stdout);d.thread.latestRunId='phone-run';x.stdout=JSON.stringify(d)}return x}
 await new T3OwnerWorker({...f,authority:async()=>true,enabled:true}).run(f.row.id,'t3:w');assert.equal(f.row.artifact,undefined);assert.equal(f.instances.length,0)
})
test('Agent37 backend key stays in transport headers, never instance body/CLI',async()=>{
 const calls=[];const p=agent37Provisioner({apiKey:'fictional-workspace-key',enabled:true,modelCreditMicros:0,template:'dock-t3-fictional@1',fetchImpl:async(url,o)=>{calls.push({url,...o});return new Response(JSON.stringify({id:'fictional1'}))}})
 await p.create({task:{id:'fixture',owner_id:'owner'},name:'dock-t3-fixture'});assert.equal(calls.length,1);assert.doesNotMatch(calls[0].body,/fictional-workspace-key/);assert.equal(JSON.parse(calls[0].body).budget.credit_micros,0)
})
test('database outage cannot prevent physical cleanup; persistence remains unresolved',async()=>{
 const f=fixture();const advance=f.store.advance;f.store.advance=async(t,next,patch)=>{if(next==='cleanup_due')throw new Error('DB unavailable');return advance(t,next,patch)}
 await assert.rejects(new T3OwnerWorker({...f,authority:async()=>true,enabled:true}).run(f.row.id,'t3:w'),/DB unavailable/);assert.equal(f.instances.length,0);assert.equal(f.row.phase,'review_required')
})
test('watchdog continues other tasks after an unverified deletion',async()=>{
 let attempted=[];const worker=new T3OwnerWorker({enabled:true,store:{due:async()=>[{id:'one'},{id:'two'}],takeCleanup:async id=>({id})},onError:()=>{}})
 worker.cleanup=async t=>{attempted.push(t.id);if(t.id==='one')throw new Error('provider unavailable')};await worker.sweep('t3:watchdog');assert.deepEqual(attempted,['one','two'])
})
test('unversioned custom template is refused before any API call',async()=>{
 let calls=0;const p=agent37Provisioner({apiKey:'fictional',enabled:true,template:'dock-t3-unpinned',fetchImpl:async()=>{calls++;throw new Error()}});await assert.rejects(p.create({task:{id:'fixture'},name:'fixture'}),/Pinned/);assert.equal(calls,0)
})
test('lost create with absent inventory is not proof final billing ended',async()=>{
 const p=agent37Provisioner({enabled:true,apiKey:'fictional',fetchImpl:async()=>new Response('{}')})
 assert.equal(await p.settled({task:{execution_id:null},deletedIds:[]}),false)
})
test('waiting status is not mistaken for terminal failure',async()=>{
 const f=fixture();const cli=f.provisioner.cli;let reads=0;f.provisioner.cli=async r=>{const x=await cli(r);if(r.args[0]==='thread'&&r.args[1]==='show'&&reads++===0){const d=JSON.parse(x.stdout);d.thread.status='waiting';x.stdout=JSON.stringify(d)}return x}
 await new T3OwnerWorker({...f,authority:async()=>true,enabled:true}).run(f.row.id,'t3:w');assert.ok(f.row.artifact);assert.equal(f.instances.length,0)
})
