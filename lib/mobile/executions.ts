import {adminClient} from '@/lib/tenancy'
import type {SupabaseClient} from '@supabase/supabase-js'
// Internal worker port only. No API route takes an 'approved' body from a model.
export function executionStore(db:SupabaseClient=adminClient()){
 async function transition(id:string,expected:string,next:string,details:Record<string,unknown>={}){const{data,error}=await db.rpc('mobile_execution_transition',{p_execution:id,p_expected:expected,p_next:next,p_details:details});if(error)throw Error(error.message);return data===true}
 async function get(id:string){const{data,error}=await db.from('mobile_executions').select('*').eq('id',id).maybeSingle();if(error)throw Error(error.message);return data}
 async function must(id:string,expected:string,next:string,details:Record<string,unknown>={}){if(!await transition(id,expected,next,details))throw Error('Execution transition already occurred or refused')}
 return{
  get,
  async uncertainProvisions(limit:number){const{data,error}=await db.from('mobile_executions').select('id').in('state',['provision_intent','reconcile']).is('instance_id',null).limit(limit);if(error)throw Error(error.message);return data??[]},
  async recoverInstance(id:string,instanceId:string){const{error}=await db.from('mobile_executions').update({instance_id:instanceId,state:'cleanup_pending',last_operational_state:'reconcile',updated_at:new Date().toISOString()}).eq('id',id).is('instance_id',null).in('state',['provision_intent','reconcile']);if(error)throw Error(error.message)},
  async provisionUnresolved(id:string,reason:string){const{error}=await db.from('mobile_execution_events').insert({execution_id:id,kind:'provision_unresolved',details:{reason}});if(error)throw Error(error.message)},
  async runningExecutions(limit:number){const{data,error}=await db.from('mobile_executions').select('id,instance_id,thread_id,run_id').in('state',['running','reconcile']).not('run_id','is',null).limit(limit);if(error)throw Error(error.message);return(data??[]).map(e=>({id:e.id,instanceId:e.instance_id,threadId:e.thread_id,runId:e.run_id}))},
  async verifyApproval(id:string){const e=await get(id);if(!e||e.state!=='approved'||!e.decision_expires_at||Date.parse(e.decision_expires_at)<=Date.now())return null;
   const{data:p,error}=await db.from('mobile_task_proposals').select('id,owner_id,workspace_id,project_id,status,approved_digest').eq('id',e.proposal_id).eq('owner_id',e.owner_id).eq('workspace_id',e.workspace_id).maybeSingle();if(error)throw error;
   if(!p||p.status!=='approved'||p.approved_digest!==e.approved_proposal_digest||p.project_id!==e.project_id||!e.owner_decision_ref||!Number.isSafeInteger(e.managed_budget_micros)||e.managed_budget_micros%10000!==0)return null;
   return{approved:true,executionId:e.id,ownerId:e.owner_id,workspaceId:e.workspace_id,projectId:e.project_id,agentId:e.agent_key,sourceCommit:e.source_commit,repoKeys:[e.repo_key],sourcePaths:e.source_paths,text:e.approved_text,totalBudgetCents:Math.floor(e.managed_budget_micros/10000),maxComputeCostMicros:e.max_compute_cost_micros,computeLifecycleApproved:e.lifecycle_approved,cleanupDeadline:e.cleanup_deadline}
  },
  async claimExecution(a:any){return await transition(a.executionId,'approved','provision_intent')?{status:'claimed'}:{status:(await get(a.executionId))?.state??'missing'}},
  async provisionIntent(a:any){if((await get(a.executionId))?.state!=='provision_intent')throw Error('Provision intent not persisted')},
  bindInstance:(a:any,id:string)=>must(a.executionId,'provision_intent','bound',{instanceId:id}),
  startIntent:(a:any)=>must(a.executionId,'bound','start_intent'),
  running:(a:any,run:any)=>must(a.executionId,'start_intent','running',{runId:run.runId,threadId:run.threadId}),
  async reconcileRequired(a:any,details:any){const e=await get(a.executionId);if(e&&['provision_intent','bound','start_intent','running'].includes(e.state))await must(e.id,e.state,'reconcile',details)},
  async recordResult(id:string,instanceId:string,runId:string,text:string,success:boolean){const{data,error}=await db.rpc('mobile_execution_result',{p_execution:id,p_instance:instanceId,p_run:runId,p_text:text,p_success:success});if(error)throw Error(error.message);return data===true},
  async cleanupDue(at:string,limit:number){const{data,error}=await db.from('mobile_executions').select('id,instance_id,lifecycle_approved,cleanup_deadline,state').not('instance_id','is',null).neq('state','cleanup_confirmed').or(`cleanup_deadline.lte.${at},state.eq.cleanup_pending`).limit(limit);if(error)throw Error(error.message);return(data??[]).map(e=>({id:e.id,executionId:e.id,instanceId:e.instance_id,lifecycleApproved:e.lifecycle_approved}))},
  async claimCleanup(id:string){const{data,error}=await db.rpc('mobile_cleanup_claim',{p_execution:id});if(error)throw Error(error.message);return data===true},
  async deleteIntent(id:string){const{error}=await db.from('mobile_execution_events').insert({execution_id:id,kind:'delete_intent'});if(error)throw Error(error.message)},
  async cleanupConfirmed(id:string,at:string){const{error}=await db.from('mobile_executions').update({state:'cleanup_confirmed',cleanup_confirmed_at:at,cleanup_lease_until:null,updated_at:at}).eq('id',id);if(error)throw Error(error.message)},
  async cleanupRetry(id:string,reason:string){const{error}=await db.from('mobile_executions').update({cleanup_last_error:reason,cleanup_lease_until:null,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw Error(error.message)},
  async cleanupBlocked(id:string,reason:string){const{error}=await db.from('mobile_execution_events').insert({execution_id:id,kind:'cleanup_blocked',details:{reason}});if(error)throw Error(error.message)}
 }
}
// Server-only hold adapter. Quote verification and provider enforcement must be
// configured separately; this does not turn an arbitrary max amount into one.
export function modelHoldStore(db:SupabaseClient=adminClient()){
 return{
  async reserve(i:{executionId:string;requestId:string;quoteId:string;maxCostMicros:number}){const{data,error}=await db.rpc('mobile_model_reserve',{p_execution:i.executionId,p_request:i.requestId,p_quote:i.quoteId,p_max:i.maxCostMicros});if(error)throw Error(error.message);return{allowed:!!data,holdId:data}},
  async settle(i:{holdId:string;requestId:string;costMicros:number}){const{error}=await db.rpc('mobile_model_settle',{p_hold:i.holdId,p_request:i.requestId,p_cost:i.costMicros});if(error)throw Error(error.message)},
  async reconcile(i:{holdId:string;requestId:string;reason:string}){const{error}=await db.from('mobile_model_holds').update({state:'reconcile'}).eq('id',i.holdId).eq('request_id',i.requestId).eq('state','reserved');if(error)throw Error(error.message)}
 }
}

// Only backend-prepared packets from verified catalogs reach this function.
// The function is not exported through a device/model write endpoint.
export async function stageExecutionReview(packet:any,db:SupabaseClient=adminClient()){
 if(packet?.status!=='needs-owner-review'||!Number.isFinite(Date.parse(packet.expiresAt))||!/^[a-f0-9]{64}$/.test(packet.digest??'')||!packet.ownerId||!packet.workspaceId||!packet.proposalId||Date.parse(packet.expiresAt)<=Date.now())throw Error('Current exact backend review packet required')
 const{data,error}=await db.from('mobile_execution_reviews').insert({proposal_id:packet.proposalId,owner_id:packet.ownerId,workspace_id:packet.workspaceId,packet,digest:packet.digest,expires_at:packet.expiresAt}).select('id').single()
 if(error)throw Error(error.message);return{id:data.id,digest:packet.digest}
}
