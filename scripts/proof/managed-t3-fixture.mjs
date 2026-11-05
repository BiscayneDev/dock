// Explicit fictional loopback inference only. Requires existing installed T3+Pi.
import http from 'node:http'
import {spawn,execFileSync,spawnSync} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {t3Service} from '../../node/dock-node/src/t3/service.mjs'
import {verifySupervisedPolicy} from '../../node/dock-node/src/t3/policy.mjs'
const [toolsDir,output]=process.argv.slice(2)
if(!toolsDir||!output)throw new Error('usage: node t3-context-fixture.mjs <installed-t3-pi-bin-dir> <result.json>')
const root=await mkdtemp(join(tmpdir(),'dock-t3-source-proof-')),repo=join(root,'base'),work=join(root,'work'),baseDir=join(root,'t3'),home=join(root,'home'),piHome=join(root,'pi'),knowledge=join(root,'knowledge')
for(const p of [repo,work,baseDir+'/userdata',home,piHome,knowledge])await mkdir(p,{recursive:true})
const hash=b=>createHash('sha256').update(b).digest('hex'),git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim()
git('init','-b','base');const source='# Fixture policy\nContext consumption canary: DOCK_SOURCE_CANARY_482\n';await writeFile(join(repo,'policy.md'),source);git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','fixture');const sha=git('rev-parse','HEAD');await rm(work,{recursive:true});git('worktree','add',work,'-b','dock/task-proof')
let requests=0,consumed=false,secretLeak=false
const model=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;requests++;consumed=body.includes('DOCK_SOURCE_CANARY_482')&&body.includes(sha);secretLeak=body.includes('FICTIONAL_HOST_SECRET_NOT_FOR_CHILD');res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'fictional',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:consumed?'CONTEXT_CONSUMED_FIXTURE_OK':'MISSING_CONTEXT'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'fictional',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n')});await new Promise(r=>model.listen(0,'127.0.0.1',r))
await writeFile(piHome+'/models.json',JSON.stringify({providers:{dockfixture:{baseUrl:`http://127.0.0.1:${model.address().port}/v1`,api:'openai-completions',apiKey:'fictional-instance-token',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:16000,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}))
await writeFile(baseDir+'/userdata/settings.json',JSON.stringify({enableProviderUpdateChecks:false,defaultRuntimeMode:'approval-required',providerInstances:{pi:{driver:'pi',enabled:true,environment:[{name:'PI_CODING_AGENT_DIR',value:piHome,sensitive:false},{name:'PI_OFFLINE',value:'1',sensitive:false}],config:{binaryPath:join(toolsDir,'pi'),launchArgs:'--offline --no-skills --no-context-files --no-mcp --provider dockfixture --model fixture'}}}}))
const portProbe=http.createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r))
const binary=toolsDir.replace(/\/node_modules\/\.bin$/,'')+'/t3-fixture-home/.t3/runtime/versions/0.1.7/t3';let log=''
const policy={schemaVersion:1,organization:'Dock local proof',settings:{defaultRuntimeMode:{value:'approval-required',locked:true}},limits:{maxRuntimeMode:'approval-required',clients:['remote','local-browser'],connect:false,telemetry:false,providers:{allowedDrivers:['pi'],instances:{pi:{locked:true,binaryPath:join(toolsDir,'pi'),launchArgs:'--offline --no-skills --no-context-files --no-mcp --provider dockfixture --model fixture',environment:[{name:'PI_CODING_AGENT_DIR',value:piHome},{name:'PI_OFFLINE',value:'1'}]}}}}}
await writeFile(join(root,'policy.json'),JSON.stringify(policy))
const prefix=['--unshare-user','--uid','0','--unshare-pid','--die-with-parent','--new-session','--cap-drop','ALL','--ro-bind','/usr','/usr','--ro-bind','/bin','/bin','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/etc/t3code','--ro-bind',join(root,'policy.json'),'/etc/t3code/policy.json','--ro-bind','/etc/passwd','/etc/passwd','--ro-bind','/etc/group','/etc/group','--ro-bind',toolsDir.replace(/\/node_modules\/\.bin$/,''),toolsDir.replace(/\/node_modules\/\.bin$/,''),'--bind',root,root,'--chdir',work,'--']
const readonly=spawnSync('bwrap',[...prefix,'python3','-c',"import os;assert os.stat('/etc/t3code/policy.json').st_uid==0;f=open('/etc/t3code/policy.json','a')"],{env:{PATH:process.env.PATH,HOME:home},stdio:['ignore','pipe','pipe']})
if(readonly.status===0||!String(readonly.stderr).includes('Read-only file system'))throw new Error('Policy write protection proof failed')
const server=spawn('bwrap',[...prefix,binary,'serve','--host','127.0.0.1','--port',String(port),'--base-dir',baseDir],{detached:true,cwd:work,env:{PATH:process.env.PATH,HOME:home,T3CODE_TELEMETRY_ENABLED:'false'}});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b)
const transport=async({args,stdin})=>new Promise((resolve,reject)=>{const p=spawn('bwrap',[...prefix,binary,...args],{env:{PATH:process.env.PATH,HOME:home,T3CODE_TELEMETRY_ENABLED:'false'}});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('exit',code=>resolve({code,stdout,stderr}));p.stdin.end(stdin)});process.env.HOST_SECRET='FICTIONAL_HOST_SECRET_NOT_FOR_CHILD'
let result
try{
 let ready=false;for(let i=0;i<180;i++){try{const r=await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`);if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!ready)throw new Error('local server readiness timeout: '+log.slice(-7000))
 const add=await transport({executionId:'fictional-private-execution',args:['project','add',work,'--base-dir',baseDir],stdin:''});if(add.code!==0)throw new Error('project registration failed')
 const evidence=await verifySupervisedPolicy(transport,{executionId:'fictional-private-execution',baseDir})
 let observed
 if(process.env.T3_SCRATCH_URI){
 const uri=process.env.T3_SCRATCH_URI,id=process.env.T3_SCRATCH_TASK
 const sql=q=>execFileSync('psql',[uri,'-qAt','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim()
 const literal=x=>"'"+String(x).replaceAll("'","''")+"'"
 const rpc=q=>JSON.parse(sql('set role service_role;select '+q))
 sql(`update t3_owner_tasks set base_sha='${sha}',brief='Read fictional policy DOCK_SOURCE_CANARY_482 ${sha}' where id='${id}'`)
 const store={get:async()=>JSON.parse(sql(`select row_to_json(t)from t3_owner_tasks t where id='${id}'`)),claim:async(i,w)=>rpc(`claim_t3_owner_task('${i}',${literal(w)})`),advance:async(t,next,patch={})=>rpc(`advance_t3_owner_task('${id}',${t.version},${literal(t.worker)},${literal(next)},${literal(JSON.stringify(patch))})`),heartbeat:async()=>true,due:async()=>[],queued:async()=>[{id}]}
 let present=false
 const provisioner={find:async({name})=>present?[{id:'localfixture',name}]:[],create:async()=>{present=true;return{id:'localfixture'}},prepare:async()=>({executionId:'localfixture',baseSha:sha,worktree:work,baseDir,model:'dockfixture/fixture'}),cli:transport,delete:async()=>{present=false},settled:async()=>!present}
 const row=await store.get(id)
 const service=t3Service({store,provisioner,sources:{[row.repo_key]:{ownerId:row.owner_id,workspaceId:row.workspace_id,projectId:row.project_id,baseSha:sha}},grants:{[id]:{taskId:id,ownerId:row.owner_id,projectId:row.project_id,baseSha:sha,userApprovalRef:'FICTIONAL_LOCAL_NO_COST_PROOF',expiresAt:row.cleanup_deadline,cleanupDeadline:row.cleanup_deadline,maxModelCreditMicros:0,maxComputeCostMicros:1,lifecycleApproved:true,watchdogReady:true}},enabled:true,onError:e=>console.error(e)})
 await service.tick('t3:local-proof');observed=await store.get(id)
 if(observed.phase!=='deleted'||!observed.artifact)throw new Error('persistent worker round trip failed')
 }else{
 const launch=await transport({args:['thread','start',work,'Read the fictional policy DOCK_SOURCE_CANARY_482 '+sha,'--provider','pi','--model','dockfixture/fixture','--wait','--json','--base-dir',baseDir],stdin:''})
 if(launch.code!==0)throw new Error('managed launch failed: '+launch.stderr)
 observed=JSON.parse(launch.stdout.trim().split('\n').findLast(x=>x.startsWith('{')))
 }
 result={fictionalModel:true,fictionalLocalProvisioner:true,paid:false,managedPolicyInjected:false,actualPolicyWriteRefused:true,actualRunningManagedPolicy:evidence,requests,promptCanaryReachedModel:consumed,hostSecretInPrompt:secretLeak,result:observed}
 if(!evidence.loaded||requests!==1)throw new Error('fixture assertion failed')
 await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{const exited=server.exitCode!==null?Promise.resolve():new Promise(r=>server.once('exit',r));const pairs=execFileSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(x=>x.trim().split(/\s+/).map(Number));const owned=new Set([server.pid]);for(let changed=true;changed;){changed=false;for(const [pid,parent]of pairs)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);changed=true}}for(const pid of [...owned].reverse())try{process.kill(pid,'SIGTERM')}catch{}await exited;await new Promise(r=>model.close(r));await rm(root,{recursive:true,force:true});delete process.env.HOST_SECRET}
