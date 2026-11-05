import{adminClient}from'@/lib/tenancy'
import{executionStore}from'./executions'
import{executionModelRequest}from'./model-gateway'
import{mailboxController,remoteMailboxIo}from'../../node/dock-node/src/execution/private-mailbox.mjs'
import{POST as memoryRequest}from'../../app/api/internal/execution-memory/route'
import{createHash}from'node:crypto'
// Dedicated controller process calls this for one durable assigned execution.
// Capability is controller-private. It is never in exec payloads or task spool.
export async function executionMailboxWorker({controller,executionId,instanceId,capability,origin}:{controller:any;executionId:string;instanceId:string;capability:string;origin:string}){
 const match=/^dockexec\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{32,200})$/i.exec(capability);if(!match)throw Error('Controller capability required');const{data:cap,error}=await adminClient().from('mobile_execution_capabilities').select('execution_id,secret_hash,expires_at,revoked_at').eq('id',match[1]).maybeSingle();if(error||!cap||cap.execution_id!==executionId||cap.revoked_at||!Number.isFinite(Date.parse(cap.expires_at))||Date.parse(cap.expires_at)<=Date.now()||cap.secret_hash!==createHash('sha256').update(match[2]).digest('hex'))throw Error('Capability must bind exact controller execution')
 const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Fixed controller origin required')
 const request=(path:string,body:any)=>new Request(new URL(path,url),{method:'POST',headers:{authorization:'Bearer '+capability,'content-type':'application/json'},body:JSON.stringify(body)})
 async function memory(body:any){const response=await memoryRequest(request('/api/internal/execution-memory',body));if(!response.ok)throw Error('Scoped memory refused');return(await response.json()).result}
 return mailboxController({executionId,io:remoteMailboxIo({controller,store:executionStore(),executionId,instanceId}),model:async({prompt}:{prompt:string})=>{const r=await executionModelRequest(request('/api/internal/execution-model/v1/chat/completions',JSON.parse(prompt)),true)as any;return JSON.stringify(r.chat)},memory:{recall:async(content:string)=>memory({operation:'recall',content}),note:async(content:string)=>memory({operation:'note',content}),distill:async(noteId:string,content:string)=>memory({operation:'distill',noteId,content})}})
}
