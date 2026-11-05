import{NextResponse}from"next/server"
import{assistantContext}from"@/lib/assistant-store"
export const dynamic="force-dynamic"
export async function GET(){
 if(process.env.DOCK_T3_TASKS!=="on")return NextResponse.json({error:"T3 tasks disabled"},{status:501})
 const ctx=await assistantContext();if(!ctx)return NextResponse.json({error:"Owner sign-in required"},{status:401})
 let sources:Record<string,Record<string,string>>;try{sources=JSON.parse(process.env.DOCK_T3_SOURCES??"{}")}catch{return NextResponse.json({error:"Source registry unavailable"},{status:503})}
 const{data,error}=await ctx.supabase.from("projects").select("id,name").eq("workspace_id",ctx.workspaceId)
 if(error)return NextResponse.json({error:"Projects unavailable"},{status:503})
 const projects=new Map((data??[]).map(p=>[p.id,p.name]))
 return NextResponse.json({sources:Object.entries(sources).filter(([,s])=>s.ownerId===ctx.userId&&s.workspaceId===ctx.workspaceId&&projects.has(s.projectId)&&/^[a-f0-9]{40}$/.test(s.baseSha)).map(([repoKey,s])=>({repoKey,projectId:s.projectId,projectName:projects.get(s.projectId),baseSha:s.baseSha}))})
}
