import {NextResponse} from "next/server"
import {assistantContext} from "@/lib/assistant-store"
import {prepareOwnerTask} from "@/lib/t3-preparation"
export const dynamic="force-dynamic"
export async function POST(request:Request){
 // Never call /api/runs resolveContext: it includes broad machine-token fallback.
 // Session-backed RPC independently validates auth.uid + run/workspace/project.
 if(process.env.DOCK_T3_PREPARATION!=="on")return NextResponse.json({error:"T3 preparation is disabled. No execution was created."},{status:501})
 const ctx=await assistantContext()
 const result=await prepareOwnerTask({enabled:true,ownerSession:ctx,input:await request.json().catch(()=>null),prepare:async input=>{
  if(!ctx)throw new Error("owner session required")
  const {data,error}=await ctx.supabase.rpc("prepare_t3_execution",{p_run_id:input.runId,p_base_sha:input.baseSha,p_cleanup_deadline:input.cleanupDeadline})
  if(error)throw new Error("preparation refused")
  return data
 }})
 return NextResponse.json(result.body,{status:result.status})
}
