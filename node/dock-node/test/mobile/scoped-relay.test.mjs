import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm,stat}from'node:fs/promises';import{tmpdir}from'node:os';import{scopedExecutionRelay,taskLoopbackBridge}from'../../src/execution/scoped-relay.mjs';import{boundedModelGateway}from'../../src/execution/gateway.mjs'
test('real private socket + loopback consumes gateway reserve/settle with fixed execution and auto routing',async()=>{
 const root=await mkdtemp(tmpdir()+'/dock-relay-'),path=root+'/model.sock';let scope,settled=false,calls=0
 const gateway=boundedModelGateway({store:{reserve:async i=>{scope=i.executionId;return{allowed:true,holdId:'h'}},settle:async()=>{settled=true},reconcile:async()=>{}},maxAttempts:3,quote:async i=>({model:i.model,promptDigest:(await import('node:crypto')).createHash('sha256').update(i.prompt).digest('hex'),quoteId:'q',maxCostMicros:2,maxOutputTokens:2048,maxAttempts:3,expiresAt:new Date(Date.now()+10000).toISOString()}),serve:async i=>{calls++;return{...i,costMicros:1,text:JSON.stringify({choices:[{message:{role:'assistant',content:'settled'}}]})}}})
 const relay=await scopedExecutionRelay({socketPath:path,executionId:'fixed-task',gateway});const bridge=await taskLoopbackBridge({socketPath:path})
 try{
 assert.equal((await stat(path)).mode&0o777,0o600)
 const url=`http://127.0.0.1:${bridge.port}/v1/chat/completions`,body={model:'auto',messages:[{role:'user',content:'fictional'}]}
 const r=await fetch(url,{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal((await r.json()).choices[0].message.content,'settled');assert.equal(settled,true);assert.equal(scope,'fixed-task')
 for(const extra of[{executionId:'sibling'},{url:'https://other.invalid'},{model:'fixed'},{n:2}])assert.equal((await fetch(url,{method:'POST',body:JSON.stringify({...body,...extra})})).status,403)
 assert.equal(calls,1);assert.equal((await fetch(url.replace('/chat/completions','/other'))).status,403)
 await assert.rejects(scopedExecutionRelay({socketPath:path,executionId:'other',gateway}))
 }finally{await bridge.close();await relay.close();await rm(root,{recursive:true,force:true})}
})
