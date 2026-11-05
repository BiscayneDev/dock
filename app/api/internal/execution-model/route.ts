import{NextResponse}from'next/server'
import{executionModelRequest}from'@/lib/mobile/model-gateway'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){try{return NextResponse.json(await executionModelRequest(request))}catch{return NextResponse.json({error:'Execution capability, decision, budget or qualified model contract refused; do not retry paid work automatically'},{status:403})}}
