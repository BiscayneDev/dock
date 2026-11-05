#!/usr/bin/env node
// Task-side fixed bridge only. Host namespace/mount policy enforces isolation.
import{mailboxRuntime}from'../src/execution/mailbox-runtime.mjs';import{resolve}from'node:path';import{randomBytes}from'node:crypto';import{spawn}from'node:child_process';import{mkdtemp,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os'
const localToken=randomBytes(32).toString('base64url'),state=await mkdtemp(tmpdir()+'/dock-pi-state-'),bridge=await mailboxRuntime({state,root:resolve(process.cwd(),'../mailbox'),localToken})
await writeFile(state+'/models.json',JSON.stringify({providers:{dockrelay:{baseUrl:'http://127.0.0.1:3781/v1',api:'openai-completions',apiKey:localToken,models:[{id:'auto',name:'Dock scoped Jev route',reasoning:false,input:['text'],contextWindow:32000,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}))
// No provider/controller credential needs to enter this process. Actual host
// provisioning must reject one in the entire workload environment, not here.
const piEnv={...process.env,PI_CODING_AGENT_DIR:state,PI_OFFLINE:'1',DOCK_MEMORY_SOCKET:bridge.memorySocket}
const registration=spawn('/usr/local/bin/pi',['mcp','add','dock-memory','--exposure','direct','--',process.execPath,'/opt/dock-relay/bin/dock-memory-mcp.mjs'],{env:piEnv,stdio:['ignore','ignore','inherit']})
const registered=await new Promise(r=>{registration.once('error',()=>r(-1));registration.once('exit',r)});if(registered!==0){await bridge.close();await rm(state,{recursive:true,force:true});throw Error('Scoped memory registration failed')}
const child=spawn('/usr/local/bin/pi',process.argv.slice(2),{stdio:'inherit',env:piEnv})
for(const sig of['SIGTERM','SIGINT'])process.on(sig,()=>child.kill(sig))
child.on('error',async()=>{await bridge.close();await rm(state,{recursive:true,force:true});process.exitCode=1})
child.on('exit',async code=>{await bridge.close();await rm(state,{recursive:true,force:true});process.exitCode=code??1})
