import {verifySupervisedPolicy} from './policy.mjs'
function parseOutput(text){const lines=String(text).trim().split('\n');const line=lines.findLast(x=>x.startsWith('{'));if(!line)throw new Error('T3 result unavailable');return JSON.parse(line)}
export class T3OwnerWorker{
 // provisioner implements one private instance, private committed-base repo +
 // worktree, pinned admin policy/T3/Pi. It must never receive the database client.
 constructor({store,provisioner,authority,enabled=false,clock=Date.now,onError=()=>{}}){Object.assign(this,{store,provisioner,authority,enabled,clock,onError})}
 async run(id,worker){
  if(!this.enabled)throw new Error('T3 worker disabled')
  let task=await this.store.get(id)
  // An owner task is not spending authority. Backend verifies exact current
  // grant including lifecycle, model budget and scheduled watchdog BEFORE claim.
  if(!await this.authority(task))throw new Error('No current lifecycle/spend authority')
  task=await this.store.claim(id,worker);if(!task)throw new Error('Task already claimed')
  const name=`dock-t3-${task.id}`
  let timer,busy=false,leaseLost=false
  const heartbeat=async()=>{if(busy)return;busy=true;try{if(!await this.store.heartbeat(task))leaseLost=true}catch{leaseLost=true}finally{busy=false}}
  timer=setInterval(heartbeat,30000)
  const active=()=>{if(leaseLost||this.clock()>=Date.parse(task.cleanup_deadline))throw new Error('Lease/deadline expired')}
  try{
   active()
   if(!await this.authority(task))throw new Error('Authority expired before create')
   // Intent already committed. No automatic create retry. Reconcile by stable
   // name in watchdog if create response is lost before execution_id saved.
   const existing=await this.provisioner.find({name,executionId:null})
   if(!Array.isArray(existing)||existing.length)throw new Error('Prior instance intent requires reconciliation')
   const execution=await this.provisioner.create({task,name})
   if(!execution||! /^[a-z0-9]{1,64}$/.test(execution.id))throw new Error('Provision outcome uncertain')
   task=await this.store.advance(task,'ready',{execution_id:execution.id})
   active()
   const bound=await this.provisioner.prepare({task})
   for(const value of [bound.worktree,bound.baseDir])if(typeof value!=='string'||!/^\/[a-zA-Z0-9/_-]+$/.test(value)||value.includes('..'))throw new Error('Invalid bound path')
   if(typeof bound.model!=='string'||!bound.model||bound.model.startsWith('-'))throw new Error('Invalid model')
   if(bound.executionId!==task.execution_id||bound.baseSha!==task.base_sha||!bound.worktree||!bound.baseDir)throw new Error('Private base binding mismatch')
   const transport=request=>this.provisioner.cli({task,...request})
   const policy=await verifySupervisedPolicy(transport,{executionId:task.execution_id,baseDir:bound.baseDir})
   if(!policy.loaded)throw new Error('Managed policy not active')
   active();task=await this.store.advance(task,'launching')
   const launch=await transport({args:['thread','start',bound.worktree,'-','--title',`Dock ${task.id}`,'--provider','pi','--model',bound.model,'--json','--base-dir',bound.baseDir],stdin:task.brief})
   if(launch.code!==0)throw new Error('Launch uncertain')
   const started=parseOutput(launch.stdout)
   task=await this.store.advance(task,'launched',{thread_id:started.threadId,run_id:started.runId})
   while(true){
    active()
    const read=await transport({args:['thread','show',task.thread_id,'--messages','100','--json','--base-dir',bound.baseDir],stdin:''})
    if(read.code!==0)throw new Error('Result unavailable')
    const result=parseOutput(read.stdout),thread=result.thread
    if(thread?.threadId!==task.thread_id||thread.latestRunId!==task.run_id||thread.runtimeMode!=='approval-required')throw new Error('Result binding/mode mismatch')
    if(thread.pendingRequestCount>0){await new Promise(r=>setTimeout(r,1000));continue}
    if(thread.status==='completed'){
     const messages=result.messages?.filter(m=>m.runId===task.run_id&&m.role==='assistant').map(m=>m.text)
     if(!messages?.length||messages.some(m=>typeof m!=='string')||messages.join('').length>100000)throw new Error('Result missing or oversized')
     const artifact={taskId:task.id,executionId:task.execution_id,threadId:task.thread_id,runId:task.run_id,messages,trusted:false,reviewRequired:true}
     task=await this.store.advance(task,'review_required',{artifact});break
    }
    if(!['running','starting','preparing','queued','waiting','idle'].includes(thread.status))throw new Error('Task failed: '+thread.status)
    await new Promise(r=>setTimeout(r,1000))
   }
  }catch(error){
   this.onError(error)
   // If storage response itself was lost, reload latest state instead of replay.
   task=await this.store.get(id).catch(()=>task)
   if(['provisioning','launching','launched'].includes(task.phase))task=await this.store.advance(task,'uncertain').catch(()=>task)
  }finally{
   clearInterval(timer)
   // Primary owns early cleanup, watchdog independently handles lost process.
   await this.cleanup(task)
  }
  return this.store.get(id)
 }
 async cleanup(task){
  if(task.phase==='deleted')return task
  let storageError
  if(task.phase!=='cleanup_due')try{task=await this.store.advance(task,'cleanup_due')}catch(e){storageError=e}
  // Always inspect name AND saved ID: create may have succeeded before response.
  const found=await this.provisioner.find({name:`dock-t3-${task.id}`,executionId:task.execution_id})
  if(!Array.isArray(found))throw new Error('Instance inventory unverified')
  for(const instance of found){
   if(instance.name!==`dock-t3-${task.id}`)throw new Error('Instance ownership mismatch')
   try{await this.provisioner.delete(instance.id)}catch{/* verify below */}
  }
  const remaining=await this.provisioner.find({name:`dock-t3-${task.id}`,executionId:task.execution_id})
  if(!Array.isArray(remaining)||remaining.length)throw new Error('Deletion unverified; watchdog retains responsibility')
  // Provider must reconcile final ledger for deleted task, not just stop/sleep.
  if(!await this.provisioner.settled({task,deletedIds:found.map(x=>x.id)}))throw new Error('Final billing unverified')
  if(storageError)throw storageError // Physical cleanup completed; durable reconciliation remains due.
  return this.store.advance(task,'deleted')
 }
 async sweep(worker,{maxTasks=100}={}){
  if(!this.enabled)throw new Error('T3 worker disabled')
  const due=await this.store.due()
  for(const{id}of due.slice(0,maxTasks)){try{const task=await this.store.takeCleanup(id,worker);if(task)await this.cleanup(task)}catch(e){this.onError(e)}}
 }
}
