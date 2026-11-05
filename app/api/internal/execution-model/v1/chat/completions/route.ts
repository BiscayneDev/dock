import{NextResponse}from'next/server'
import{executionModelRequest}from'@/lib/mobile/model-gateway'
export const runtime='nodejs'
export const dynamic='force-dynamic'
// No streaming of uncertain output. Entire upstream result must be billed and
// settled before any assistant text or tool call reaches the private runtime.
export async function POST(request:Request){try{
 const result=await executionModelRequest(request,true)as any
 if(!result.stream)return NextResponse.json(result.chat)
 const r=result.chat,m=r.choices[0].message
 const chunks=[{...r,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:m.content??null,...m.tool_calls?{tool_calls:m.tool_calls.map((t:any,index:number)=>({...t,index}))}:{}},finish_reason:null}]},{...r,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:r.choices[0].finish_reason}]}]
 return new Response(chunks.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream','cache-control':'no-store'}})
 }catch{return NextResponse.json({error:{message:'Exact capability, quote, scope or settlement refused. No automatic retry.',type:'scope_or_budget_refused'}},{status:403})}}
