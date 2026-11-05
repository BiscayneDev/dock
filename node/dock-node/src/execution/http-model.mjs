// Qualified server-owned fixed-model transport, not a general proxy. Credential
// stays controller-side. Pricing/attempt enforcement must come from an actual
// reviewed upstream contract, never a client body or discovered model label.
import{createHash}from'node:crypto'
import{boundChatRequest,boundChatResult}from'./chat-contract.mjs'
export function pricedModelTransport({endpoint,apiKey,contract,fetchImpl=fetch,clock=Date.now,structuredChat=false}){
 const url=new URL(endpoint)
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!apiKey||!contract?.evidence||!contract.singleAttemptEnforced||!contract.noHiddenBillableSteps||!Number.isSafeInteger(contract.inputMicrosPerToken)||contract.inputMicrosPerToken<0||!Number.isSafeInteger(contract.outputMicrosPerToken)||contract.outputMicrosPerToken<0||!contract.model||!Number.isFinite(Date.parse(contract.expiresAt)))throw Error('Qualified fixed-model price/attempt contract required')
 const quotes=new Map()
 return{
  async quote({model,prompt,maxOutputTokens,maxAttempts}){
   if(model!==contract.model||maxOutputTokens!==2048||maxAttempts!==1||Date.parse(contract.expiresAt)<=clock())throw Error('Model price contract stale or unsupported')
   // Contract must guarantee a UTF-8-byte input upper bound incl. provider framing.
   if(!contract.byteTokenUpperBound||!Number.isSafeInteger(contract.framingTokens)||contract.framingTokens<0)throw Error('Input pricing upper bound unavailable')
   if(structuredChat){if(!contract.toolSchemaByteTokenUpperBound)throw Error('Structured tool pricing upper bound unavailable');const bound=boundChatRequest(JSON.parse(prompt));if(bound.prompt!==prompt||bound.body.model!==model)throw Error('Canonical bound chat required')}
   const promptDigest=createHash('sha256').update(prompt).digest('hex'),maxCostMicros=(Buffer.byteLength(prompt)+contract.framingTokens)*contract.inputMicrosPerToken+2048*contract.outputMicrosPerToken
   if(!Number.isSafeInteger(maxCostMicros))throw Error('Quoted cost invalid')
   const quoteId=createHash('sha256').update(promptDigest+contract.evidence+model+maxCostMicros+clock()).digest('hex');const q={quoteId,promptDigest,model,maxOutputTokens,maxAttempts,maxCostMicros,expiresAt:new Date(Math.min(clock()+60000,Date.parse(contract.expiresAt))).toISOString()};quotes.set(quoteId,{...q,used:false});return q
  },
  async serve(i){
   const q=quotes.get(i.quoteId);if(!q||q.used||q.model!==i.model||q.promptDigest!==i.promptDigest||createHash('sha256').update(i.prompt).digest('hex')!==q.promptDigest||Date.parse(q.expiresAt)<=clock()||i.maxOutputTokens!==2048||i.maxAttempts!==1||i.maxRetries!==0)throw Error('Exact unused quote required')
   if(quotes.size>10000)for(const[key,value]of quotes)if(value.used||Date.parse(value.expiresAt)<=clock())quotes.delete(key)
   q.used=true // uncertain HTTP outcomes never reuse this quote or retry
   const response=await fetchImpl(url,{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},redirect:'error',signal:i.signal,body:structuredChat?i.prompt:JSON.stringify({model:q.model,messages:[{role:'user',content:i.prompt}],max_tokens:2048,stream:false})})
   if(!response.ok)throw Error('Upstream response uncertain/refused')
   const result=await response.json();const usage=result.usage
   if(result.model!==q.model||!Number.isSafeInteger(usage?.prompt_tokens)||usage.prompt_tokens<0||!Number.isSafeInteger(usage?.completion_tokens)||usage.completion_tokens<0||usage.completion_tokens>2048)throw Error('Bound authoritative usage required')
   const costMicros=usage.prompt_tokens*contract.inputMicrosPerToken+usage.completion_tokens*contract.outputMicrosPerToken
   if(!Number.isSafeInteger(costMicros)||costMicros>q.maxCostMicros||(!structuredChat&&typeof result.choices?.[0]?.message?.content!=='string'))throw Error('Cost or output violates reviewed quote')
   return{quoteId:q.quoteId,requestId:i.requestId,promptDigest:q.promptDigest,model:q.model,costMicros,text:structuredChat?JSON.stringify(boundChatResult(result,JSON.parse(i.prompt))):result.choices[0].message.content}
  }
 }
}
