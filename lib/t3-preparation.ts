/** Owner-only preparation, never launch or money authority. No model/vendor call. */
export interface PreparationInput { runId: string; baseSha: string; cleanupDeadline: string }
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function parsePreparation(raw: unknown, now=Date.now()): PreparationInput | null {
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const x=raw as Record<string,unknown>
 if(Object.keys(x).some(k=>!["runId","baseSha","cleanupDeadline"].includes(k)))return null
 if(typeof x.runId!=="string"||!UUID.test(x.runId)||typeof x.baseSha!=="string"||!/^[a-f0-9]{40}$/.test(x.baseSha)||typeof x.cleanupDeadline!=="string")return null
 const deadline=Date.parse(x.cleanupDeadline)
 if(!Number.isFinite(deadline)||deadline<=now||deadline>now+30*60*1000)return null
 return {runId:x.runId,baseSha:x.baseSha,cleanupDeadline:new Date(deadline).toISOString()}
}
export async function prepareOwnerTask({enabled,ownerSession,input,prepare}: {
 enabled:boolean;ownerSession:{userId:string;workspaceId:string}|null;input:unknown;
 prepare:(input:PreparationInput)=>Promise<unknown>
}):Promise<{status:number;body:Record<string,unknown>}> {
 if(!enabled)return {status:501,body:{error:"T3 preparation is disabled. No execution was created."}}
 if(!ownerSession)return {status:401,body:{error:"Owner sign-in required"}}
 const parsed=parsePreparation(input)
 if(!parsed)return {status:400,body:{error:"runId, resolved baseSha and cleanupDeadline within 30 minutes required; no owner or execution fields accepted"}}
 try{return{status:200,body:{preparation:await prepare(parsed),executionCreated:false,launchAuthorized:false}}}
 catch{return{status:409,body:{error:"Run cannot be prepared in this owner context"}}}
}
