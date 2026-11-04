import { createHash } from 'node:crypto'
import {verifySupervisedPolicy} from './policy.mjs'
import { taskPrompt } from './context.mjs'
export class T3Bridge {
 // Transport executes inside ONE already provisioned private execution. It is not
 // an Agent37 workspace API credential. No provisioning/paid transport registered.
 constructor({registry,transport,enabled=false,policyVerifier=verifySupervisedPolicy}) {this.registry=registry;this.transport=transport;this.enabled=enabled;this.policyVerifier=policyVerifier}
 async launch(scope,{brief,context,hostBinding,provider,model}) {
  if(!this.enabled)throw new Error('T3 bridge disabled')
  const row=await this.registry.get(scope)
  if(row.state!=='reserved'||row.deadlineMs<=Date.now())throw new Error('launch unavailable; reconcile or clean up')
  // This assertion is made by a trusted provisioner, not request JSON or a model.
  // It is a required seam, not claimed proof of OS isolation.
  if(!hostBinding||hostBinding.executionId!==row.executionId||hostBinding.baseSha!==row.baseSha||hostBinding.kind!=='private-instance'||typeof hostBinding.worktree!=='string'||typeof hostBinding.baseDir!=='string'||!hostBinding.supervised)throw new Error('verified private execution binding required')
  for(const p of [hostBinding.worktree,hostBinding.baseDir])if(p.includes('..')||!/^\/[a-zA-Z0-9/_-]+$/.test(p))throw new Error('unsafe private path')
  if(typeof provider!=='string'||!provider||typeof model!=='string'||!model)throw new Error('explicit provider and model required')
  if(!context?.bundle||context.sha256!==createHash('sha256').update(JSON.stringify(context.bundle)).digest('hex'))throw new Error('context bundle hash mismatch')
  const policy=await this.policyVerifier(this.transport,{executionId:row.executionId,baseDir:hostBinding.baseDir})
  if(policy?.executionId!==row.executionId||policy?.baseDir!==hostBinding.baseDir||policy.maxRuntimeMode!=='approval-required'||policy.loaded!==true||! /^[a-f0-9]{12}$/.test(policy.fingerprint??''))throw new Error('running supervised policy not verified')
  const prompt=taskPrompt(brief,context)
  let current=await this.registry.transition(scope,row.version,'launching')
  try {
   // --wait deliberately absent: persist thread+run before observing completion.
   const result=await this.transport({executionId:row.executionId,args:['thread','start',hostBinding.worktree,'-','--title',`Dock ${row.taskRef}`,'--provider',provider,'--model',model,'--json','--base-dir',hostBinding.baseDir],stdin:prompt})
   if(result.code!==0)throw new Error('launch result uncertain')
   const data=JSON.parse(result.stdout)
   current=await this.registry.transition(scope,current.version,'launched',{threadId:data.threadId,runId:data.runId,baseDir:hostBinding.baseDir,contextSha256:context.sha256})
   return {mapping:current,contextSha256:context.sha256}
  }catch{await this.registry.transition(scope,current.version,'uncertain').catch(()=>{});throw new Error('T3 launch uncertain; never blindly retry')}
 }
 async observe(scope) {
  if(!this.enabled)throw new Error('T3 bridge disabled')
  const row=await this.registry.get(scope)
  if(row.state!=='launched'||row.deadlineMs<=Date.now())throw new Error('observation unavailable; cleanup or reconcile')
  const baseDir=row.baseDir
  if(typeof baseDir!=='string'||!/^\/[a-zA-Z0-9/_-]+$/.test(baseDir)||baseDir.includes('..'))throw new Error('missing bound base directory')
  const result=await this.transport({executionId:row.executionId,args:['thread','show',row.threadId,'--messages','100','--json','--base-dir',baseDir],stdin:''})
  if(result.code!==0)throw new Error('thread observation failed')
  const data=JSON.parse(result.stdout),thread=data.thread
  // A new phone turn must not substitute its result for the original run.
  if(thread?.threadId!==row.threadId || thread.latestRunId!==row.runId)throw new Error('thread/run correlation mismatch')
  if(thread.status==='running'||thread.status==='starting'||thread.status==='queued')return {state:'running'}
  if(thread.pendingRequestCount>0){await this.registry.transition(scope,row.version,'waiting');return {state:'waiting',needsHuman:true}}
  if(thread.runtimeMode!=='approval-required')throw new Error('thread permission mode mismatch')
  if(thread.status!=='completed'){await this.registry.transition(scope,row.version,'failed');return {state:'failed'}}
  const messages=data.messages?.filter(m=>m.role==='assistant'&&m.runId===row.runId)
  if(!messages?.length||messages.some(m=>typeof m.text!=='string')||messages.reduce((n,m)=>n+m.text.length,0)>100000)throw new Error('bounded matching result missing')
  const artifact={taskRef:row.taskRef,executionId:row.executionId,threadId:row.threadId,runId:row.runId,state:'review_required',messages:messages.map(m=>m.text),trusted:false}
  const sha256=createHash('sha256').update(JSON.stringify(artifact)).digest('hex')
  await this.registry.archive(scope,artifact)
  await this.registry.transition(scope,row.version,'review_required',{artifactSha256:sha256})
  return {state:'review_required',artifact,sha256}
 }
}
