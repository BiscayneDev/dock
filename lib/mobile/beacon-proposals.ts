// Untrusted model output can suggest facts, never promote them. Exact candidate
// text is separately reviewed. No extra extraction/model call or auto sharing.
export function parseBeaconCandidates(text:string){
 const candidates:string[]=[]
 const visible=text.replace(/```beacon_memory\s*([\s\S]*?)```/g,(_block,body)=>{
  try{const value=JSON.parse(body);if(Array.isArray(value))for(const item of value){if(typeof item==='string'&&item.trim().length&&item.length<=2000&&candidates.length<4&&!/(?:github_pat_|ghp_|sk-[A-Za-z0-9]|BEGIN .*PRIVATE KEY|password\s*[:=]|api[_ -]?key\s*[:=])/i.test(item))candidates.push(item.trim())}}catch{}
  return''
 })
 return{text:visible.trim(),candidates}
}
