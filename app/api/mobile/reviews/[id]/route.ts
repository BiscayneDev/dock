import{ownerOriginMatches}from'@/lib/mobile/origin'
import{NextResponse}from'next/server'
import{assistantContext,isUuid}from'@/lib/assistant-store'
import{adminClient}from'@/lib/tenancy'
export const runtime='nodejs'
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await assistantContext();if(!ctx)return NextResponse.json({error:'Sign in required'},{status:401})
 const{id}=await params;if(!isUuid(id))return NextResponse.json({error:'Not found'},{status:404})
 const{data,error}=await adminClient().from('mobile_execution_reviews').select('id,packet,digest,expires_at,state').eq('id',id).eq('owner_id',ctx.userId).eq('workspace_id',ctx.workspaceId).maybeSingle()
 if(error)return NextResponse.json({error:'Review unavailable'},{status:503});if(!data)return NextResponse.json({error:'Not found'},{status:404})
 return NextResponse.json({review:data,approvalAvailable:process.env.DOCK_EXECUTION_REVIEW_ENABLED==='true'})
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await assistantContext();if(!ctx)return NextResponse.json({error:'Sign in required'},{status:401})
 if(!ownerOriginMatches(request))return NextResponse.json({error:'Same-origin owner action required'},{status:403})
 if(process.env.DOCK_EXECUTION_REVIEW_ENABLED!=='true')return NextResponse.json({error:'Execution review is not activated'},{status:503})
 const{id}=await params;if(!isUuid(id))return NextResponse.json({error:'Not found'},{status:404})
 let body;try{body=await request.json()}catch{return NextResponse.json({error:'Exact review required'},{status:400})}
 if(body.decision!=='approve'||typeof body.digest!=='string'||!/^[a-f0-9]{64}$/.test(body.digest))return NextResponse.json({error:'Exact displayed review digest required'},{status:400})
 const{data,error}=await adminClient().rpc('mobile_owner_approve',{p_review:id,p_owner:ctx.userId,p_workspace:ctx.workspaceId,p_digest:body.digest})
 if(error)return NextResponse.json({error:'Review changed, expired or no longer permitted'},{status:409})
 return NextResponse.json({executionId:data,state:'approved',started:false})
}
