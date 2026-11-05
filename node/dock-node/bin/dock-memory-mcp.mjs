#!/usr/bin/env node
import{createInterface}from'node:readline'
import{executionMemoryClient}from'../src/execution/memory-client.mjs'
import{socketMemoryClient}from'../src/execution/scoped-memory-socket.mjs'
import{executionMemoryMcp}from'../src/execution/memory-mcp.mjs'
if(!process.env.DOCK_MEMORY_SOCKET&&(!process.env.DOCK_URL||!process.env.DOCK_EXECUTION_TOKEN)){console.error('Execution-scoped memory pairing required');process.exit(1)}
const handle=executionMemoryMcp({memory:process.env.DOCK_MEMORY_SOCKET?socketMemoryClient({socketPath:process.env.DOCK_MEMORY_SOCKET}):executionMemoryClient({url:process.env.DOCK_URL,token:process.env.DOCK_EXECUTION_TOKEN})})
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 if(line.length>16000)continue
 let request;try{request=JSON.parse(line)}catch{continue}
 try{const result=await handle(request);if(request.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:result??{}})+'\n')}
 catch{if(request.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32602,message:'Execution memory refused'}})+'\n')}
}
