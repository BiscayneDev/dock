// Read-only completion reconciliation. No thread-send/new run/purchase occurs.
// Controller must return the exact bound instance/thread/run from persisted state.
export function executionResults({store,controller}){
 return async function collect(){let recorded=0,pending=0;for(const job of await store.runningExecutions(100)){
  const result=await controller.readRun({executionId:job.id,instanceId:job.instanceId,threadId:job.threadId,runId:job.runId});
  if(!result||result.instanceId!==job.instanceId||result.threadId!==job.threadId||result.runId!==job.runId)throw Error('Controller result binding mismatch');
  if(!['complete','failed','cancelled'].includes(result.status)){pending++;continue;}
  if(typeof result.text!=='string'||result.text.length>200000)throw Error('Invalid completed output');
  if(await store.recordResult(job.id,job.instanceId,job.runId,result.text,result.status==='complete'))recorded++;
 }return{recorded,pending};}
}
