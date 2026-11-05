import{adminClient}from'@/lib/tenancy'
import type{SupabaseClient}from'@supabase/supabase-js'
type BoundMemory={deviceId:string;ownerId:string;workspaceId:string;projectId:string|null;agentId:string}
const args=(p:BoundMemory)=>({p_device:p.deviceId,p_owner:p.ownerId,p_workspace:p.workspaceId,p_project:p.projectId,p_agent:p.agentId})
// Existing memory_items only. No Dinghy client, database join or implicit import.
export function beaconMemory(db:SupabaseClient=adminClient()){
 async function call(name:string,input:Record<string,unknown>){const{data,error}=await db.rpc(name,input);if(error)throw Error('Scoped Beacon memory refused');return data}
 return{
  recall:(p:BoundMemory,query:string)=>call('beacon_mobile_recall',{...args(p),p_query:query,p_limit:8}),
  note:(p:BoundMemory,content:string,source:string)=>call('beacon_mobile_note',{...args(p),p_content:content,p_source:source}),
  distill:(p:BoundMemory,noteId:string,content:string)=>call('beacon_mobile_distill',{...args(p),p_note:noteId,p_content:content}),
 }
}
export async function beaconReviewCandidates(ownerId:string,workspaceId:string,db:SupabaseClient=adminClient()){
 const{data,error}=await db.from('memory_items').select('id,content,project_id,author_agent,source_reference,created_at').eq('owner_id',ownerId).eq('workspace_id',workspaceId).eq('visibility','agent').eq('memory_state','proposed').order('created_at',{ascending:false}).limit(50)
 if(error)throw Error('Memory candidates unavailable');return data??[]
}
