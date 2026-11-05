import{executionStore}from'./executions'
import{adminClient}from'@/lib/tenancy'
import{executionCleanup}from'../../node/dock-node/src/execution/cleanup.mjs'
import{executionResults}from'../../node/dock-node/src/execution/results.mjs'
import{provisionReconciler}from'../../node/dock-node/src/execution/reconcile.mjs'
import{agent37ExecutionController}from'../../node/dock-node/src/execution/agent37.mjs'
// Separate controller invocation, no dispatcher/create/start call reachable here.
export async function maintainMobileExecutions(){
 if(process.env.DOCK_EXECUTION_MAINTENANCE_ENABLED!=='true')throw Error('Maintenance not activated')
 const retained=(process.env.DOCK_RETAINED_INSTANCE_IDS??'').split(',').map(x=>x.trim()).filter(Boolean)
 if(!retained.length)throw Error('Retained instances must be explicitly protected')
 const controller=agent37ExecutionController({apiKey:process.env.AGENT37_API_KEY,enabled:true,template:process.env.DOCK_EXECUTION_TEMPLATE,launchCommand:undefined,inspectCommand:undefined,verifyControllerBoundary:undefined})
 const store=executionStore(),db=adminClient();const at=new Date().toISOString()
 // Cleanup runs first so model/result outages cannot defer a due deletion.
 const cleanup=await executionCleanup({store,controller,retainedInstanceIds:retained})()
 const uncertain=await provisionReconciler({store,controller})()
 // Every result is still bound to current stored instance/thread/run identity.
 let results:any;try{results=await executionResults({store,controller})()}catch{results={unconfirmed:true}}
 const status={at,cleanup,uncertain,results}
 const{error}=await db.from('mobile_maintenance_heartbeats').insert({worker_key:'controller-maintenance',details:status})
 if(error)throw Error('Maintenance heartbeat not persisted')
 return status
}
