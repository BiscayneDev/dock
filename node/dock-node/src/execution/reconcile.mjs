// Read controller inventory after uncertain creation. Never buys a replacement
// and never starts a run based on absence or a guessed client-side identity.
export function provisionReconciler({store,controller}){
 return async()=>{let found=0,unresolved=0;for(const job of await store.uncertainProvisions(100)){
  const matches=await controller.findExecution(job.id)
  if(matches.length===1){await store.recoverInstance(job.id,matches[0].id);found++}
  else{await store.provisionUnresolved(job.id,matches.length?'Multiple matching instances require review':'No matching instance confirmed; never repurchase');unresolved++}
 }return{found,unresolved}}
}
