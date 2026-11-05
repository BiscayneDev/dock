import {T3OwnerWorker} from './worker.mjs'
import {verifySupervisedPolicy} from './policy.mjs'
const parse=text=>{const line=String(text).trim().split('\n').findLast(x=>x.startsWith('{'));if(!line)throw new Error('Missing correlated output');return JSON.parse(line)}
// One bounded control step per invocation. Never sleep/poll or retry a write.
// A killed provisioning/launching step is cleanup-only, never resumed as work.
export class DurableT3Worker extends T3OwnerWorker{
 async step(id,worker){
  if(!this.enabled)throw new Error('T3 worker disabled')
  const initial=await this.store.get(id)
  if(!await this.authority(initial))throw new Error('No current lifecycle/spend authority')
  let task=await this.store.claimStep(id,worker);if(!task)return null
  const active=()=>{if(this.clock()>=Date.parse(task.cleanup_deadline))throw new Error('Deadline expired')}
  try{
   active()
   if(task.phase==='provisioning'){
    if(!await this.authority(task))throw new Error('Authority expired before create')
    const prior=await this.provisioner.find({name:`dock-t3-${task.id}`,executionId:null})
    if(!Array.isArray(prior)||prior.length)throw new Error('Prior intent requires reconciliation')
    const execution=await this.provisioner.create({task,name:`dock-t3-${task.id}`})
    if(!execution||! /^[a-z0-9]{1,64}$/.test(execution.id))throw new Error('Provision outcome uncertain')
    active()
    task=await this.store.advance(task,'ready',{execution_id:execution.id})
   }else if(task.phase==='ready'){
    const bound=await this.provisioner.prepare({task});active()
    const baseDir=`/home/node/dock-t3/${task.id}`,worktree=`/home/node/dock/${task.id}/work`
    if(bound.executionId!==task.execution_id||bound.baseSha!==task.base_sha||bound.baseDir!==baseDir||bound.worktree!==worktree||bound.model!=='agent37/default'||bound.policyRootOwned!==true||bound.policyReadOnlyToAgent!==true)throw new Error('Private binding mismatch')
    const policy=await verifySupervisedPolicy(r=>this.provisioner.cli({task,...r}),{executionId:task.execution_id,baseDir})
    if(!policy.loaded||!await this.authority(task))throw new Error('Policy/authority not current')
    // Commit launch intent before external write. Never retry this phase.
    task=await this.store.advance(task,'launching');active()
    const output=await this.provisioner.cli({task,args:['thread','start',worktree,'-','--title',`Dock ${task.id}`,'--provider','pi','--model',bound.model,'--json','--base-dir',baseDir],stdin:task.brief})
    if(output.code!==0)throw new Error('Launch uncertain')
    const started=parse(output.stdout)
    task=await this.store.advance(task,'launched',{thread_id:started.threadId,run_id:started.runId})
   }else if(task.phase==='launched'){
    const output=await this.provisioner.cli({task,args:['thread','show',task.thread_id,'--messages','100','--json','--base-dir',`/home/node/dock-t3/${task.id}`],stdin:''})
    if(output.code!==0)throw new Error('Result unavailable')
    const result=parse(output.stdout),thread=result.thread
    if(thread?.threadId!==task.thread_id||thread.latestRunId!==task.run_id||thread.runtimeMode!=='approval-required')throw new Error('Result correlation/mode mismatch')
    if(thread.status==='completed'&&!thread.pendingRequestCount){
     const messages=result.messages?.filter(m=>m.runId===task.run_id&&m.role==='assistant').map(m=>m.text)
     if(!messages?.length||messages.some(m=>typeof m!=='string')||messages.join('').length>100000)throw new Error('Missing bounded result')
     task=await this.store.advance(task,'review_required',{artifact:{taskId:task.id,executionId:task.execution_id,threadId:task.thread_id,runId:task.run_id,messages,trusted:false,reviewRequired:true}})
     await this.cleanup(task);return this.store.get(id)
    }
    if(!thread.pendingRequestCount&&!['running','starting','preparing','queued','waiting','idle'].includes(thread.status))throw new Error('Task failed')
   }else throw new Error('Phase cannot resume work')
   active()
   await this.store.releaseStep(task)
   return this.store.get(id)
  }catch(error){
   this.onError(error)
   task=await this.store.get(id).catch(()=>task)
   // A stale invocation cannot delete a resource now owned by another step.
   if(task.worker!==worker)return task
   if(['provisioning','launching','launched'].includes(task.phase))task=await this.store.advance(task,'uncertain').catch(()=>task)
   await this.cleanup(task)
   return this.store.get(id)
  }
 }
}
