// Explicit fictional loopback inference only. Requires existing installed T3+Pi.
import http from 'node:http'
import {spawn,execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {TaskRegistry} from '../../node/dock-node/src/t3/registry.mjs'
import {buildTaskContext} from '../../node/dock-node/src/t3/context.mjs'
import {issueContextCapability} from '../../node/dock-node/src/t3/capability.mjs'
import {readScopedContext} from '../../node/dock-node/src/t3/context-service.mjs'
import {T3Bridge} from '../../node/dock-node/src/t3/bridge.mjs'
import {localCliTransport} from '../../node/dock-node/src/t3/local-cli.mjs'
const [toolsDir,output]=process.argv.slice(2)
if(!toolsDir||!output)throw new Error('usage: node t3-context-fixture.mjs <installed-t3-pi-bin-dir> <result.json>')
const root=await mkdtemp(join(tmpdir(),'dock-t3-source-proof-')),repo=join(root,'base'),work=join(root,'work'),baseDir=join(root,'t3'),home=join(root,'home'),piHome=join(root,'pi'),knowledge=join(root,'knowledge')
for(const p of [repo,work,baseDir+'/userdata',home,piHome,knowledge])await mkdir(p,{recursive:true})
const hash=b=>createHash('sha256').update(b).digest('hex'),git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim()
git('init','-b','base');const source='# Fixture policy\nContext consumption canary: DOCK_SOURCE_CANARY_482\n';await writeFile(join(repo,'policy.md'),source);git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','fixture');const sha=git('rev-parse','HEAD');await rm(work,{recursive:true});git('worktree','add',work,'-b','dock/task-proof')
const manifest={createdAt:'fictional-fixture',files:[{source:'fixture/policy.md',commit:sha,sha256:hash(source)}]},graph={dock:{manifestSha256:hash(JSON.stringify(manifest))},nodes:[{label:'fixture policy',source_file:'fixture/policy.md',source_location:'L1'}]}
await writeFile(join(knowledge,'manifest.json'),JSON.stringify(manifest));await writeFile(join(knowledge,'graph.json'),JSON.stringify(graph))
let requests=0,consumed=false,secretLeak=false
const model=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;requests++;consumed=body.includes('DOCK_SOURCE_CANARY_482')&&body.includes(sha);secretLeak=body.includes('FICTIONAL_HOST_SECRET_NOT_FOR_CHILD');res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'fictional',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:consumed?'CONTEXT_CONSUMED_FIXTURE_OK':'MISSING_CONTEXT'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'fictional',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n')});await new Promise(r=>model.listen(0,'127.0.0.1',r))
await writeFile(piHome+'/models.json',JSON.stringify({providers:{dockfixture:{baseUrl:`http://127.0.0.1:${model.address().port}/v1`,api:'openai-completions',apiKey:'fictional-instance-token',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:16000,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}))
await writeFile(baseDir+'/userdata/settings.json',JSON.stringify({enableProviderUpdateChecks:false,defaultRuntimeMode:'approval-required',providerInstances:{pi:{driver:'pi',enabled:true,environment:[{name:'PI_CODING_AGENT_DIR',value:piHome,sensitive:false},{name:'PI_OFFLINE',value:'1',sensitive:false}],config:{binaryPath:join(toolsDir,'pi'),launchArgs:'--offline --no-skills --no-context-files --no-mcp --provider dockfixture --model fixture'}}}}))
const binary=join(toolsDir,'t3'),port=43775;let log=''
const server=spawn(binary,['serve','--host','127.0.0.1','--port',String(port),'--base-dir',baseDir],{detached:true,cwd:work,env:{PATH:process.env.PATH,HOME:home,T3CODE_TELEMETRY_ENABLED:'false'}});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b)
const transport=localCliTransport({binary,home,enabled:true,executionId:'fictional-private-execution'});process.env.HOST_SECRET='FICTIONAL_HOST_SECRET_NOT_FOR_CHILD'
let result
try{
 let ready=false;for(let i=0;i<180;i++){try{const r=await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`);if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!ready)throw new Error('local server readiness timeout')
 const add=await transport({executionId:'fictional-private-execution',args:['project','add',work,'--base-dir',baseDir],stdin:''});if(add.code!==0)throw new Error('project registration failed')
 const registry=new TaskRegistry(join(root,'registry')),scope={ownerId:'fixture-owner',workspaceId:'fixture-ws',projectId:'fixture-project',taskRef:'task-proof',executionId:'fictional-private-execution'};await registry.reserve({...scope,baseSha:sha,deadlineMs:Date.now()+120000})
 const {token,record:capability}=issueContextCapability(scope)
 const context=await readScopedContext({registry,capability,token,scope,query:'fixture policy',sourceConfig:{directory:knowledge,repositories:{fixture:repo},allowedSources:['fixture/policy.md']}})
 const bridge=new T3Bridge({registry,transport,enabled:true});await bridge.launch(scope,{brief:'Read shared policy. Return fixture response only.',context,hostBinding:{executionId:scope.executionId,kind:'private-instance',worktree:work,baseDir,supervised:true,baseSha:sha},provider:'pi',model:'dockfixture/fixture'})
 let observed;for(let i=0;i<60;i++){observed=await bridge.observe(scope);if(observed.state!=='running')break;await new Promise(r=>setTimeout(r,200))}
 result={fictional:true,paid:false,osIsolationTested:false,requests,committedSourceReachedModel:consumed,hostSecretInPrompt:secretLeak,contextSha256:context.sha256,result:observed,record:await registry.get(scope)}
 if(!consumed||secretLeak||requests!==1||observed.state!=='review_required')throw new Error('fixture assertion failed')
 await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{const exited=new Promise(r=>server.once('exit',r));const pairs=execFileSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(x=>x.trim().split(/\s+/).map(Number));const owned=new Set([server.pid]);for(let changed=true;changed;){changed=false;for(const [pid,parent]of pairs)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);changed=true}}for(const pid of [...owned].reverse())try{process.kill(pid,'SIGTERM')}catch{}await exited;await new Promise(r=>model.close(r));await rm(root,{recursive:true,force:true});delete process.env.HOST_SECRET}
