export function parseT3OwnerTask(raw:unknown,now=Date.now()){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const x=raw as Record<string,unknown>
 if(Object.keys(x).some(k=>!["requestId","projectId","repoKey","baseSha","brief","cleanupDeadline"].includes(k)))return null
 if(typeof x.requestId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x.requestId)||typeof x.projectId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x.projectId)||typeof x.repoKey!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x.repoKey)||typeof x.baseSha!=="string"||!/^[a-f0-9]{40}$/.test(x.baseSha)||typeof x.brief!=="string"||!x.brief.trim()||x.brief.length>8000||typeof x.cleanupDeadline!=="string")return null
 const deadline=Date.parse(x.cleanupDeadline);if(!Number.isFinite(deadline)||deadline<=now||deadline>now+1800000)return null
 return{requestId:x.requestId,projectId:x.projectId,repoKey:x.repoKey,baseSha:x.baseSha,brief:x.brief.trim(),cleanupDeadline:new Date(deadline).toISOString()}
}
