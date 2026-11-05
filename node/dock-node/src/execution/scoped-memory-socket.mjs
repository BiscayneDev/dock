import http from'node:http';import{chmod,lstat,unlink}from'node:fs/promises'
// Controller binds memory client to a single execution capability. Workload
// cannot select identity, destination, capability or a business-promotion verb.
export async function scopedMemorySocket({socketPath,memory}){
 if(!socketPath?.startsWith('/')||!memory?.recall||!memory?.note||!memory?.distill)throw Error('Fixed private memory binding required')
 try{await lstat(socketPath);throw Error('Refuse existing socket/path')}catch(e){if(e.code!=='ENOENT')throw e}
 const server=http.createServer(async(req,res)=>{try{
  if(req.method!=='POST'||req.url!=='/memory')throw Error('Fixed route required');let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>12000)throw Error('Memory body too large')}
  const b=JSON.parse(raw),allowed=b.operation==='distill'?['operation','content','noteId']:['operation','content'];if(Object.keys(b).some(k=>!allowed.includes(k))||typeof b.content!=='string'||!b.content.trim()||b.content.length>(b.operation==='recall'?1000:2000)||!['recall','note','distill'].includes(b.operation)||b.operation==='distill'&&(typeof b.noteId!=='string'||b.noteId.length>200))throw Error('Scoped memory arguments required')
  const result=b.operation==='recall'?await memory.recall(b.content):b.operation==='note'?await memory.note(b.content):await memory.distill(b.noteId,b.content);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result}))
 }catch{res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'Scoped memory refused'}))}})
 server.requestTimeout=20000;await new Promise((r,j)=>{server.once('error',j);server.listen(socketPath,r)});await chmod(socketPath,0o600);return{close:async()=>{await new Promise(r=>server.close(r));await unlink(socketPath).catch(()=>{})}}
}
export function socketMemoryClient({socketPath}){
 if(!socketPath?.startsWith('/'))throw Error('Fixed mounted memory socket required')
 async function call(operation,content,noteId){return new Promise((resolve,reject)=>{const req=http.request({socketPath,path:'/memory',method:'POST',headers:{'content-type':'application/json'}},res=>{let raw='';res.on('data',x=>{raw+=x;if(Buffer.byteLength(raw)>1000000)req.destroy(Error('Memory response too large'))});res.on('end',()=>{try{if(res.statusCode!==200)throw Error('Scoped memory refused');resolve(JSON.parse(raw).result)}catch(e){reject(e)}})});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('Memory timeout')));req.end(JSON.stringify({operation,content,...noteId?{noteId}:{}}))})}
 return{recall:q=>call('recall',q),note:c=>call('note',c),distill:(id,c)=>call('distill',c,id)}
}
