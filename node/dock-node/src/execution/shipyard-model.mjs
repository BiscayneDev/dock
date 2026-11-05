// Consumes an actual request-bound quote, not route preview/catalog pricing.
// Jev chooses the coding candidate; no model pin or client-set monetary bound.
import{createHash}from'node:crypto'
import{boundChatRequest,boundChatResult}from'./chat-contract.mjs'
export function quotedShipyardTransport({endpoint,apiKey,contract,fetchImpl=fetch,clock=Date.now}){
 const url=new URL(endpoint)
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1/chat/completions')||!apiKey||!contract?.evidence||!contract.revision||contract.kind!=='shipyard-stage-quote'||!Number.isFinite(Date.parse(contract.expiresAt)))throw Error('Reviewed stable stage-price deployment required')
 const quoteUrl=new URL(url);quoteUrl.pathname=url.pathname.replace(/chat\/completions$/,'chat/quote');const quotes=new Map()
 const digest=s=>createHash('sha256').update(s).digest('hex')
 return{
  maxAttempts:3,
  async quote({model,prompt,maxOutputTokens,maxAttempts}){
   if(model!=='auto'||maxOutputTokens!==2048||maxAttempts!==3||Date.parse(contract.expiresAt)<=clock())throw Error('Current Jev-preserving quote required')
   const b=boundChatRequest(JSON.parse(prompt));if(b.prompt!==prompt||b.body.model!=='auto')throw Error('Canonical auto chat required')
   const body={...b.body,shipyard:{no_fallback:true}},serialized=JSON.stringify(body)
   const r=await fetchImpl(quoteUrl,{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),body:serialized});if(!r.ok)throw Error('Authoritative quote refused');const q=await r.json()
   if(q.revision!==contract.revision||q.request_digest!==digest(serialized)||q.attempt_limit!==3||!Number.isSafeInteger(q.max_cost_micros)||q.max_cost_micros<0||!Number.isFinite(Date.parse(q.expires_at))||Date.parse(q.expires_at)<=clock()||Date.parse(q.expires_at)>Date.parse(contract.expiresAt)||typeof q.quote_id!=='string'||!/^[a-f0-9-]{36}$/i.test(q.quote_id))throw Error('Bound price quote unavailable')
   const quote={model,promptDigest:digest(prompt),maxOutputTokens,maxAttempts,quoteId:q.quote_id,maxCostMicros:q.max_cost_micros,expiresAt:q.expires_at};quotes.set(q.quote_id,{quote,body,prompt,used:false});return quote
  },
  async serve(i){
   const saved=quotes.get(i.quoteId),q=saved?.quote;if(!q||saved.used||i.prompt!==saved.prompt||i.promptDigest!==q.promptDigest||i.model!=='auto'||i.maxAttempts!==3||i.maxRetries!==0||i.maxOutputTokens!==2048||Date.parse(q.expiresAt)<=clock()||Date.parse(contract.expiresAt)<=clock())throw Error('Exact unused quoted chat required');saved.used=true
   const r=await fetchImpl(url,{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},redirect:'error',signal:i.signal,body:JSON.stringify({...saved.body,shipyard:{...saved.body.shipyard,price_quote_id:q.quoteId}})})
   if(!r.ok||r.headers.get('x-shipyard-price-revision')!==contract.revision||r.headers.get('x-shipyard-price-quote')!==q.quoteId)throw Error('Exact settled stage response unavailable')
   const raw=r.headers.get('x-shipyard-priced-cost-micros');if(raw===null||!/^\d+$/.test(raw))throw Error('Authoritative all-stage charge required');const costMicros=Number(raw);if(!Number.isSafeInteger(costMicros)||costMicros>q.maxCostMicros)throw Error('Price bound violated')
   const result=boundChatResult(await r.json(),saved.body);return{model:'auto',quoteId:q.quoteId,requestId:i.requestId,promptDigest:q.promptDigest,costMicros,text:JSON.stringify(result)}
  }
 }
}
