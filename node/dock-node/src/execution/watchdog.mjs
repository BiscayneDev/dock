// Standalone backend worker loop, independent of workload/T3/model liveness.
// Does not deploy itself or grant lifecycle authority. Host supervisor must run
// this in a separate controller failure domain and report missed heartbeats.
export async function runExecutionWatchdog({sweep,heartbeat,reportFailure,signal,intervalMs=30000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(intervalMs<5000||intervalMs>60000)throw Error('Reviewed cleanup cadence required')
 while(!signal.aborted){
  try{const result=await sweep();await heartbeat({at:new Date().toISOString(),...result});if(result.unresolved)await reportFailure({reason:'Cleanup unresolved',count:result.unresolved})}
  catch{await reportFailure({reason:'Cleanup worker failed; deadlines remain unconfirmed'})}
  if(!signal.aborted)await sleep(intervalMs)
 }
}
