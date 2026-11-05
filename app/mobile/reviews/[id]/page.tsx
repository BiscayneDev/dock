import{redirect,notFound}from'next/navigation'
import{assistantContext,isUuid}from'@/lib/assistant-store'
import{adminClient}from'@/lib/tenancy'
import Review from'./Review'
export const dynamic='force-dynamic'
export default async function Page({params}:{params:Promise<{id:string}>}){
 const ctx=await assistantContext();if(!ctx)redirect('/login');const{id}=await params;if(!isUuid(id))notFound()
 const{data,error}=await adminClient().from('mobile_execution_reviews').select('id,packet,digest,expires_at,state').eq('id',id).eq('owner_id',ctx.userId).eq('workspace_id',ctx.workspaceId).maybeSingle()
 if(error||!data)notFound();return <Review review={data} approvalAvailable={process.env.DOCK_EXECUTION_REVIEW_ENABLED==='true'}/>
}
