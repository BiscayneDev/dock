import{randomBytes,createHash}from'node:crypto'
import{adminClient}from'@/lib/tenancy'
import type{SupabaseClient}from'@supabase/supabase-js'
// Internal provisioner only. Return directly to the exact private execution
// transport, never a phone route, model prompt, source tree, log or public File.
export async function issueExecutionCapability(executionId:string,expiresAt:string,db:SupabaseClient=adminClient()){
 if(process.env.DOCK_EXECUTION_MODEL_ENABLED!=='true'||!Number.isFinite(Date.parse(expiresAt)))throw Error('Qualified execution gateway not activated')
 const secret=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(secret).digest('hex')
 const{data,error}=await db.rpc('mobile_capability_issue',{p_execution:executionId,p_hash:hash,p_expires:expiresAt})
 if(error||!data)throw Error('Exact execution capability issuance refused')
 return{capabilityId:data,token:'dockexec.'+data+'.'+secret,expiresAt}
}
