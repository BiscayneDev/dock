import {NextResponse} from "next/server"
import {assistantContext,projectInWorkspace} from "@/lib/assistant-store"
import {parseT3OwnerTask} from "@/lib/t3-owner-task"
export const dynamic="force-dynamic"
export async function GET(){
 if(process.env.DOCK_T3_TASKS!=="on")return NextResponse.json({error:"T3 tasks disabled"},{status:501})
 const ctx=await assistantContext();if(!ctx)return NextResponse.json({error:"Owner sign-in required"},{status:401})
 const{data,error}=await ctx.supabase.from("t3_owner_tasks").select("id,project_id,brief,phase,result_outcome,artifact,artifact_sha256,cleanup_deadline,created_at").eq("owner_id",ctx.userId).eq("workspace_id",ctx.workspaceId).order("created_at",{ascending:false}).limit(50)
 return error?NextResponse.json({error:"Task read failed"},{status:500}):NextResponse.json({tasks:data})
}
export async function POST(request:Request){
 if(process.env.DOCK_T3_TASKS!=="on")return NextResponse.json({error:"T3 tasks disabled; nothing created"},{status:501})
 const ctx=await assistantContext();if(!ctx)return NextResponse.json({error:"Owner sign-in required"},{status:401})
 const x=parseT3OwnerTask(await request.json().catch(()=>null));if(!x)return NextResponse.json({error:"Invalid scoped task"},{status:400})
 if(!await projectInWorkspace(ctx,x.projectId))return NextResponse.json({error:"Project not found"},{status:404})
 const{data,error}=await ctx.supabase.rpc("submit_t3_owner_task",{p_request:x.requestId,p_project:x.projectId,p_repo:x.repoKey,p_sha:x.baseSha,p_brief:x.brief,p_deadline:x.cleanupDeadline})
 return error?NextResponse.json({error:"Task refused"},{status:409}):NextResponse.json({id:data,accepted:true,spendAuthorized:false},{status:201})
}
