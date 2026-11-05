import{scopedExecutionRelay,taskLoopbackBridge}from'./scoped-relay.mjs';import{scopedMemorySocket}from'./scoped-memory-socket.mjs';import{taskMailbox}from'./private-mailbox.mjs'
// All sockets/listeners are task-local. Controller access uses documented exec,
// not injected remote mounts. Listener is fixed127.0.0.1, never0.0.0.0.
export async function mailboxRuntime({state,root,localToken}){
 const call=taskMailbox({root}),model=await scopedExecutionRelay({socketPath:state+'/model.sock',executionId:'local-untrusted-mailbox',gateway:async({prompt})=>JSON.stringify(await call('model',JSON.parse(prompt)))})
 const memory=await scopedMemorySocket({socketPath:state+'/memory.sock',memory:{recall:content=>call('memory',{operation:'recall',content}),note:content=>call('memory',{operation:'note',content}),distill:(noteId,content)=>call('memory',{operation:'distill',noteId,content})}})
 const bridge=await taskLoopbackBridge({socketPath:state+'/model.sock',port:3781,localToken})
 return{memorySocket:state+'/memory.sock',close:async()=>{await bridge.close();await model.close();await memory.close()}}
}
