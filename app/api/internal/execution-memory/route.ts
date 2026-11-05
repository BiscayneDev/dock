import{memoryLooksSecret}from'@/node/dock-node/src/execution/memory-secret-filter.mjs'
import{NextResponse}from'next/server'
import{createHash}from'node:crypto'
import{adminClient}from'@/lib/tenancy'
export const runtime='nodejs'
export async function POST(request:Request){
 if(process.env.DOCK_BEACON_ENABLED!=='true')return NextResponse.json({error:'Beacon memory not activated'},{status:503})
 const cap=/^Bearer dockexec\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{32,200})$/i.exec(request.headers.get('authorization')??'')
 if(!cap)return NextResponse.json({error:'Execution capability required'},{status:401})
 try{const raw=await request.text();if(Buffer.byteLength(raw)>12000)throw Error();const body=JSON.parse(raw);if(!['recall','note','distill'].includes(body.operation)||typeof body.content!=='string'||body.content.length>2000||body.operation!=='recall'&&memoryLooksSecret(body.content)||body.noteId&&!/^[a-f0-9-]{36}$/i.test(body.noteId))throw Error()
 const{data,error}=await adminClient().rpc('beacon_execution_memory',{p_capability:cap[1],p_hash:createHash('sha256').update(cap[2]).digest('hex'),p_operation:body.operation,p_content:body.content,p_note:body.noteId??null});if(error)throw Error();return NextResponse.json({result:data})
 }catch{return NextResponse.json({error:'Current execution scope or memory request refused'},{status:403})}
}
