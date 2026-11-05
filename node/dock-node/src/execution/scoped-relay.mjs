import http from'node:http'
import{chmod,lstat,unlink}from'node:fs/promises'
import{boundChatRequest,boundChatResult}from'./chat-contract.mjs'
// Controller owns this socket and its fixed execution binding. No URL/provider
// credential is accepted from the workload. Deploy with private per-task mount.
export async function scopedExecutionRelay({socketPath,executionId,gateway}){
 if(typeof socketPath!=='string'||!socketPath.startsWith('/')||!executionId||typeof gateway!=='function')throw Error('Fixed private relay binding required')
 try{await lstat(socketPath);throw Error('Refuse existing socket/path')}catch(e){if(e.code!=='ENOENT')throw e}
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||req.url!=='/v1/chat/completions')throw Error('Fixed model route only')
   let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>170000)throw Error('Relay body too large')}
   const b=boundChatRequest(JSON.parse(raw));if(b.body.model!=='auto')throw Error('Jev auto route required')
   const result=boundChatResult(JSON.parse(await gateway({executionId,requestId:b.requestId,model:'auto',prompt:b.prompt})),b.body)
   if(b.stream){const m=result.choices[0].message;const chunks=[{...result,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:m.content??null,...m.tool_calls?{tool_calls:m.tool_calls.map((t,index)=>({...t,index}))}:{}},finish_reason:null}]},{...result,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:result.choices[0].finish_reason}]}];res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});res.end(chunks.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n')}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result))}
  }catch{res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'Scoped relay refused; do not retry uncertain work'}))}
 });server.requestTimeout=95000;server.headersTimeout=10000
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve)});await chmod(socketPath,0o600)
 return{close:async()=>{await new Promise(r=>server.close(r));await unlink(socketPath).catch(()=>{})}}
}
// Task-side loopback bridge has no controller/provider credential. It reaches
// exactly the mounted Unix socket. A namespace denies all external networking.
export async function taskLoopbackBridge({socketPath,port=0}){
 if(typeof socketPath!=='string'||!socketPath.startsWith('/'))throw Error('Mounted socket required')
 const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(403);res.end();return}
  let bytes=0;const upstream=http.request({socketPath,path:'/v1/chat/completions',method:'POST',headers:{'content-type':'application/json'}},reply=>{res.writeHead(reply.statusCode??502,{'content-type':reply.headers['content-type']??'application/json','cache-control':'no-store'});reply.pipe(res)})
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});upstream.setTimeout(95000,()=>upstream.destroy())
  req.on('data',x=>{bytes+=x.length;if(bytes>170000){upstream.destroy();req.destroy()}else upstream.write(x)});req.on('end',()=>upstream.end());req.on('error',()=>upstream.destroy())
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
 return{port:server.address().port,close:()=>new Promise(r=>server.close(r))}
}
