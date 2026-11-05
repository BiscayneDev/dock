// Independent monitor of durable heartbeat evidence, not workload self-report.
// Deployment supplies a read-only heartbeat reader and approved alert route.
export function maintenanceHeartbeatMonitor({latest,alert,clock=Date.now,maxAgeMs=90000}){
 if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<60000||maxAgeMs>300000)throw Error('Explicit missed-heartbeat threshold required')
 let lastState='unknown'
 return async()=>{
  let state='unknown'
  try{const receipt=await latest();const at=Date.parse(receipt?.at);state=Number.isFinite(at)&&at<=clock()+5000&&clock()-at<=maxAgeMs?'healthy':'missing'}catch{}
  if(state!=='healthy'&&state!==lastState)await alert({reason:state==='missing'?'Maintenance heartbeat missing or stale':'Maintenance heartbeat source unavailable',state})
  lastState=state;return{state}
 }
}
