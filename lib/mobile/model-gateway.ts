import{readFile}from'node:fs/promises'
import{createHash,timingSafeEqual}from'node:crypto'
import{adminClient}from'@/lib/tenancy'
import{modelHoldStore}from'./executions'
import{boundChatRequest}from'../../node/dock-node/src/execution/chat-contract.mjs'
import{boundedModelGateway}from'../../node/dock-node/src/execution/gateway.mjs'
import{quotedShipyardTransport}from'../../node/dock-node/src/execution/shipyard-model.mjs'
import{pricedModelTransport}from'../../node/dock-node/src/execution/http-model.mjs'
// Per-execution bearer only, never an owner/controller key. Capability hashes
// are created by trusted provisioning after exact decision, not by the phone.
export async function executionModelRequest(request:Request,chat=false){
 if(process.env.DOCK_EXECUTION_MODEL_ENABLED!=='true')throw Error('Execution model gateway not activated')
 const match=/^Bearer dockexec\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{32,200})$/i.exec(request.headers.get('authorization')??'')
 if(!match)throw Error('Execution capability required')
 const db=adminClient();const{data:cap,error}=await db.from('mobile_execution_capabilities').select('execution_id,secret_hash,expires_at,revoked_at').eq('id',match[1]).maybeSingle()
 const hash=createHash('sha256').update(match[2]).digest('hex')
 if(error||!cap||cap.revoked_at||Date.parse(cap.expires_at)<=Date.now()||typeof cap.secret_hash!=='string'||cap.secret_hash.length!==hash.length||!timingSafeEqual(Buffer.from(hash),Buffer.from(cap.secret_hash)))throw Error('Capability expired or revoked')
 const bytes=await request.text();if(Buffer.byteLength(bytes)>170000)throw Error('Request too large')
 const raw=JSON.parse(bytes);const bound=chat?boundChatRequest(raw):null;const input=bound?{model:bound.body.model,prompt:bound.prompt,requestId:bound.requestId}:raw
 if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.requestId)||typeof input.model!=='string'||typeof input.prompt!=='string')throw Error('Bound model request required')
 const path=process.env.DOCK_EXECUTION_MODEL_CONTRACT;if(!path?.startsWith('/'))throw Error('Private qualified model contract unavailable')
 const contract=JSON.parse(await readFile(path,'utf8'))
 if(contract.kind==='shipyard-stage-quote'&&!chat)throw Error('Quoted routing requires structured chat')
 const transport=contract.kind==='shipyard-stage-quote'?quotedShipyardTransport({endpoint:contract.endpoint,apiKey:process.env.DOCK_EXECUTION_UPSTREAM_KEY,contract}):pricedModelTransport({endpoint:contract.endpoint,apiKey:process.env.DOCK_EXECUTION_UPSTREAM_KEY,contract,structuredChat:chat})
 const store=modelHoldStore(db);const gateway=boundedModelGateway({store:{...store,reserve:async(i:{requestId:string;quoteId:string;maxCostMicros:number})=>{const{data,error}=await db.rpc('mobile_capability_reserve',{p_capability:match[1],p_hash:hash,p_request:i.requestId,p_quote:i.quoteId,p_max:i.maxCostMicros});if(error)throw Error('Capability reservation refused');return{allowed:!!data,holdId:data}}},...transport})
 const text=await gateway({executionId:cap.execution_id,requestId:input.requestId,model:input.model,prompt:input.prompt});return chat?{chat:JSON.parse(text),stream:bound?.stream}:{text}
}
