// Outbound-denied remote transport candidate. A workload-side socket writes
// canonical requests to a private per-task spool. Controller uses authenticated
// fixed exec reads/writes, not workload networking or cross-host Unix mounts.
import{mkdir,writeFile,readFile,rename,unlink,readdir}from'node:fs/promises';import{createHash,randomUUID}from'node:crypto'
const digest=s=>createHash('sha256').update(s).digest('hex'),idPattern=/^[a-f0-9-]{36}$/
export function taskMailbox({root,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=90000}){
 if(!root?.startsWith('/')||timeoutMs<1000||timeoutMs>90000)throw Error('Fixed private spool required')
 return async function call(kind,body){
  if(!['model','memory'].includes(kind))throw Error('Fixed mailbox operation required')
  const id=randomUUID(),serialized=JSON.stringify({id,kind,body}),hash=digest(serialized);if(Buffer.byteLength(serialized)>80000)throw Error('Mailbox request too large')
  await mkdir(root,{recursive:true,mode:0o700});await writeFile(root+'/'+id+'.tmp',serialized,{flag:'wx',mode:0o600});await rename(root+'/'+id+'.tmp',root+'/'+id+'.request')
  const until=Date.now()+timeoutMs
  while(Date.now()<until){try{const raw=await readFile(root+'/'+id+'.response','utf8');if(Buffer.byteLength(raw)>200000)throw Error('Mailbox response too large');const r=JSON.parse(raw);if(r.id!==id||r.requestHash!==hash||r.ok!==true)throw Error('Mailbox response uncertain or refused');await unlink(root+'/'+id+'.response');return r.result}catch(e){if(e.code!=='ENOENT')throw e}await sleep(100)}
  // Never resubmit. Controller may already have dispatched paid work.
  throw Error('Mailbox outcome unknown; keep reservation and do not retry')
 }
}
export function mailboxController({io,executionId,model,memory}){
 if(!executionId||!io?.readNext||!io?.claim||!io?.reply||typeof model!=='function'||!memory)throw Error('Fixed controller mailbox binding required')
 return async function sweep(){const raw=await io.readNext();if(raw===null)return{processed:false};if(typeof raw!=='string'||Buffer.byteLength(raw)>80000)throw Error('Mailbox body bound');const b=JSON.parse(raw);if(!idPattern.test(b.id??'')||Object.keys(b).some(k=>!['id','kind','body'].includes(k))||!['model','memory'].includes(b.kind))throw Error('Mailbox envelope refused');const requestHash=digest(raw)
  // Durable exclusive claim before model dispatch. Unknown claim means no retry.
  if(!await io.claim(b.id,requestHash))return{processed:false,uncertain:true};let result
  try{if(b.kind==='model'){const{boundChatRequest}=await import('./chat-contract.mjs');const q=boundChatRequest(b.body);if(q.body.model!=='auto')throw Error('Auto route required');result=JSON.parse(await model({executionId,requestId:q.requestId,model:'auto',prompt:q.prompt}))}else{const x=b.body,keys=x?.operation==='distill'?['operation','content','noteId']:['operation','content'];if(!x||Object.keys(x).some(k=>!keys.includes(k))||typeof x.content!=='string'||!x.content.trim()||x.content.length>(x.operation==='recall'?1000:2000)||!['recall','note','distill'].includes(x.operation)||x.operation==='distill'&&(typeof x.noteId!=='string'||x.noteId.length>200))throw Error('Scoped memory input required');result=x.operation==='recall'?await memory.recall(x.content):x.operation==='note'?await memory.note(x.content):await memory.distill(x.noteId,x.content)}
   await io.reply(b.id,JSON.stringify({id:b.id,requestHash,ok:true,result}));return{processed:true}
  }catch{await io.reply(b.id,JSON.stringify({id:b.id,requestHash,ok:false}));return{processed:true,refused:true}}
 }
}
// Local proof adapter. Remote adapter must bind fixed exec path to exact host.
export function filesystemMailboxIo({root}){return{
 readNext:async()=>{await mkdir(root,{recursive:true,mode:0o700});const name=(await readdir(root)).filter(x=>/^[a-f0-9-]{36}\.request$/.test(x)).sort()[0];return name?readFile(root+'/'+name,'utf8'):null},
 claim:async(id,hash)=>{try{await writeFile(root+'/'+id+'.claimed',hash,{flag:'wx',mode:0o600});await unlink(root+'/'+id+'.request');return true}catch(e){if(e.code==='EEXIST')return false;throw e}},
 reply:async(id,text)=>{await writeFile(root+'/'+id+'.response.tmp',text,{flag:'wx',mode:0o600});await rename(root+'/'+id+'.response.tmp',root+'/'+id+'.response')}
}}
export function remoteMailboxIo({controller,store,instanceId,executionId}){
 if(!controller?.readMailbox||!controller?.replyMailbox||!store?.claimMailbox||!store?.claimedMailboxes||!instanceId||!executionId)throw Error('Controller-owned durable dispatch claim required')
 return{readNext:async()=>controller.readMailbox({instanceId,executionId,skip:await store.claimedMailboxes({instanceId,executionId})}),claim:(requestId,requestHash)=>store.claimMailbox({instanceId,executionId,requestId,requestHash}),reply:(requestId,text)=>controller.replyMailbox({instanceId,executionId,requestId,text})}
}
