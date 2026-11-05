// Execution context never falls back to broad owner recall or parent scratch.
// Identity is supplied only by the dispatcher after its durable approval check.
export function scopedMemoryReader({enabled,executionRecall,mobileRecall,legacyRecall}){
 return async(owner,query,projectId,limit,principal)=>{
  if(principal?.executionId){
   if(!enabled())throw Error('Execution-scoped memory unavailable')
   return executionRecall(principal.executionId,query)
  }
  return enabled()?mobileRecall({...principal,projectId},query):legacyRecall(owner,query,projectId,limit)
 }
}
