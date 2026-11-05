import{persistentT3Store}from'./persistent-store.mjs'
import{agent37Provisioner}from'./agent37.mjs'
import{privateBootstrap}from'./bootstrap.mjs'
import{publicSnapshotReader}from'./http-snapshot.mjs'
import{t3Service}from'./service.mjs'
// Backend-only configuration. No environment values or provider errors returned
// to callers. Cleanup is separately enabled so create can be stopped without
// disabling deletion. Task grants are exact approval records, not API payloads.
export async function vercelT3Tick(db,{cleanupOnly=false,env=process.env,workerId='t3:vercel',fetchImpl=fetch,onError=()=>{}}={}){
 const enabled=cleanupOnly?env.DOCK_T3_CLEANUP==='on':env.DOCK_T3_SERVICE==='on'
 if(!enabled)return{enabled:false}
 if(env.DOCK_T3_CLEANUP!=='on'||!env.AGENT37_API_KEY)throw new Error('Private lifecycle not configured')
 const config=cleanupOnly?{}:JSON.parse(env.DOCK_T3_BACKEND_CONFIG??'{}')
 const sources=config.sources??{},grants=()=>JSON.parse(env.DOCK_T3_BACKEND_CONFIG??'{}').grants??{}
 const provisioner=agent37Provisioner({enabled:true,apiKey:env.AGENT37_API_KEY,template:config.template,execTimeoutMs:40000,fetchImpl,bootstrap:privateBootstrap,sourceSnapshot:publicSnapshotReader(sources,{fetchImpl}),budgetForTask:async task=>(await grants())[task.id]?.maxModelCreditMicros})
 const service=t3Service({enabled:true,durable:true,store:persistentT3Store(db),provisioner,sources,grants,onError})
 // A single control step limits source/bootstrap/CLI wall-time below one lease.
 // Cleanup endpoint remains independent of this source/grant admission logic.
 await service.tick(workerId,{cleanupOnly,maxTasks:1})
 return{enabled:true}
}
