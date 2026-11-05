import{T3OwnerWorker}from'./worker.mjs'
import{DurableT3Worker}from'./durable-worker.mjs'
// A real service tick. Separate cleanup process uses the same entrypoint with
// cleanupOnly=true and needs no create/model authority. No generic queue fallback.
export function t3Service({store,provisioner,sources,grants,enabled=false,durable=false,clock=Date.now,onError=()=>{}}){
 const authority=async task=>{
  const source=sources[task.repo_key],grant=(typeof grants==='function'?await grants():grants)[task.id]
  return !!(source&&grant&&source.ownerId===task.owner_id&&source.projectId===task.project_id&&source.workspaceId===task.workspace_id&&source.baseSha===task.base_sha&&grant.ownerId===task.owner_id&&grant.projectId===task.project_id&&grant.baseSha===task.base_sha&&grant.taskId===task.id&&typeof grant.userApprovalRef==='string'&&grant.userApprovalRef.trim()&&Date.parse(grant.expiresAt)>clock()&&Date.parse(grant.cleanupDeadline)===Date.parse(task.cleanup_deadline)&&grant.lifecycleApproved===true&&grant.watchdogReady===true&&grant.maxComputeCostMicros>0&&Number.isSafeInteger(grant.maxComputeCostMicros)&&grant.maxModelCreditMicros>=0&&Number.isSafeInteger(grant.maxModelCreditMicros))
 }
 const worker=new (durable?DurableT3Worker:T3OwnerWorker)({store,provisioner,authority,enabled,clock,onError})
 return{async tick(workerId,{cleanupOnly=false,maxTasks=10}={}){
  if(!enabled)throw new Error('T3 service disabled')
  if(!durable||cleanupOnly)await worker.sweep(workerId,{maxTasks})
  if(cleanupOnly)return
  let processed=0
  for(const{id}of await (durable?store.runnable():store.queued())){
   if(processed>=maxTasks)break
   try{const task=await store.get(id);if(await authority(task)){processed++;await worker[durable?'step':'run'](id,workerId)}}catch(e){onError(e)}
  }
 },authority}
}
