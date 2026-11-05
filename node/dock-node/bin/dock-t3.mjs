#!/usr/bin/env node
import{readFile,stat}from'node:fs/promises'
import{createClient}from'@supabase/supabase-js'
import{persistentT3Store}from'../src/t3/persistent-store.mjs'
import{agent37Provisioner}from'../src/t3/agent37.mjs'
import{snapshotReader}from'../src/t3/snapshot.mjs'
import{privateBootstrap}from'../src/t3/bootstrap.mjs'
import{t3Service}from'../src/t3/service.mjs'
if(process.env.DOCK_T3_SERVICE!=='on')throw new Error('T3 service disabled; no API calls made')
const path=process.env.DOCK_T3_CONFIG;if(!path)throw new Error('Private service config required')
const mode=await stat(path);if((mode.mode&0o077)!==0)throw new Error('Config must be mode0600')
const config=JSON.parse(await readFile(path,'utf8'))
async function currentGrants(){const s=await stat(path);if((s.mode&0o077)!==0||s.uid!==mode.uid)throw new Error('Private grant config changed permissions');return JSON.parse(await readFile(path,'utf8')).grants??{}}
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const store=persistentT3Store(db)
// One task per service tick; task-specific grant drives exact model cap.
const sources=config.sources??{},grants=currentGrants
const sourceSnapshot=snapshotReader(Object.fromEntries(Object.entries(sources).map(([key,s])=>[key,{path:s.path,files:s.files}])))
const provisioner=agent37Provisioner({enabled:true,apiKey:process.env.AGENT37_API_KEY,template:config.template,sourceSnapshot,bootstrap:privateBootstrap,modelCreditMicros:0,budgetForTask:async task=>(await currentGrants())[task.id]?.maxModelCreditMicros})
const service=t3Service({store,provisioner,sources,grants,enabled:true,onError:()=>console.error('T3 task or cleanup unresolved; retained for reconciliation')})
const workerId=`t3:${process.env.DOCK_T3_WORKER_ID??'private-service'}`
const cleanupOnly=process.argv.includes('--cleanup-only'),once=process.argv.includes('--once')
let stopped=false;process.on('SIGINT',()=>{stopped=true});process.on('SIGTERM',()=>{stopped=true})
do{await service.tick(workerId,{cleanupOnly});if(once||stopped)break;await new Promise(r=>setTimeout(r,10000))}while(!stopped)
