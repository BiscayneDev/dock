import{createHash}from'node:crypto'
// Controller-side model-call envelope. The store must atomically reserve the
// quoted worst-case amount under a current exact owner decision, not a boolean.
// Unknown provider charges retain their reservation and require reconciliation.
export function boundedModelGateway({store,quote,serve,clock=Date.now}){
 return async function request(input){
  if(!input.executionId||!input.requestId||typeof input.model!=='string'||typeof input.prompt!=='string'||Buffer.byteLength(input.prompt)>160000)throw Error('Bound model request required')
  const promptDigest=createHash('sha256').update(input.prompt).digest('hex')
  const q=await quote({model:input.model,prompt:input.prompt,maxOutputTokens:2048,maxAttempts:1})
  if(!q||q.model!==input.model||q.promptDigest!==promptDigest||!Number.isSafeInteger(q.maxCostMicros)||q.maxCostMicros<0||!Number.isFinite(Date.parse(q.expiresAt))||!q.quoteId||Date.parse(q.expiresAt)<=clock()||q.maxOutputTokens!==2048||q.maxAttempts!==1)throw Error('Current enforceable request quote required')
  const hold=await store.reserve({executionId:input.executionId,requestId:input.requestId,quoteId:q.quoteId,maxCostMicros:q.maxCostMicros})
  if(!hold?.allowed||!hold.holdId)throw Error('Current owner scope or budget refused')
  try{
   const result=await serve({model:q.model,prompt:input.prompt,maxOutputTokens:q.maxOutputTokens,maxRetries:0,maxAttempts:1,quoteId:q.quoteId,requestId:input.requestId,promptDigest,signal:AbortSignal.timeout(90000)})
   if(result?.quoteId!==q.quoteId||result?.requestId!==input.requestId||result?.promptDigest!==promptDigest||result.model!==q.model||!Number.isSafeInteger(result.costMicros)||result.costMicros<0||result.costMicros>q.maxCostMicros||typeof result.text!=='string'||result.text.length>200000)throw Error('Provider settlement does not match bound quote')
   await store.settle({holdId:hold.holdId,requestId:input.requestId,costMicros:result.costMicros})
   return result.text
  }catch(e){await store.reconcile({holdId:hold.holdId,requestId:input.requestId,reason:'Charge or settlement uncertain; keep reservation, no retry'});throw e}
 }
}
