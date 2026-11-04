// Pure orchestration seam. No vendor implementation or scheduler registration.
// Deadline tracking alone does not delete anything. An authorized host watchdog
// must invoke this, verify vendor state and reconcile billing before closure.
export async function cleanupExecution({registry,scope,deleteExecution,readExecution}){
 let task=await registry.get(scope)
 if(task.state==='deleted')return task
 if(task.state!=='cleanup_due')task=await registry.transition(scope,task.version,'cleanup_due')
 // Deletion can have landed even when its response was lost. Read before retry.
 let state=await readExecution(task.executionId)
 if(state!=='absent'){
  if(state!=='present')throw new Error('deletion state unverified')
  try{await deleteExecution(task.executionId)}catch{/* Outcome must be read, not assumed. */}
  state=await readExecution(task.executionId)
 }
 if(state!=='absent')throw new Error('execution deletion unverified; retain cleanup responsibility')
 return registry.transition(scope,task.version,'deleted')
}
