import{ownerOriginMatches}from'@/lib/mobile/origin'
import{NextResponse}from'next/server'
import{assistantContext,isUuid}from'@/lib/assistant-store'
import{adminClient}from'@/lib/tenancy'
import{beaconReviewCandidates}from'@/lib/mobile/beacon'
export async function POST(request:Request){
 const ctx=await assistantContext();if(!ctx)return NextResponse.json({error:'Sign in required'},{status:401})
 if(!ownerOriginMatches(request))return NextResponse.json({error:'Same-origin owner action required'},{status:403})
 if(process.env.DOCK_BEACON_ENABLED!=='true')return NextResponse.json({error:'Beacon memory not activated'},{status:503})
 let body;try{body=await request.json()}catch{return NextResponse.json({error:'Exact candidate required'},{status:400})}
 if(!isUuid(body.candidateId??'')||typeof body.content!=='string'||body.content.length>4000)return NextResponse.json({error:'Exact candidate required'},{status:400})
 const{data,error}=await adminClient().rpc('beacon_promote',{p_candidate:body.candidateId,p_actor:ctx.userId,p_content:body.content})
 if(error)return NextResponse.json({error:'Candidate or business authority changed'},{status:409})
 return NextResponse.json({memoryId:data,visibility:'business'})
}

export async function GET(){const ctx=await assistantContext();if(!ctx)return NextResponse.json({error:'Sign in required'},{status:401});if(process.env.DOCK_BEACON_ENABLED!=='true')return NextResponse.json({error:'Beacon memory not activated'},{status:503});try{return NextResponse.json({candidates:await beaconReviewCandidates(ctx.userId,ctx.workspaceId),shared:false})}catch{return NextResponse.json({error:'Candidates unavailable'},{status:503})}}
