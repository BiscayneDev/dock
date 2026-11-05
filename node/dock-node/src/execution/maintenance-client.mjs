// Supervisor-side adapter: maintenance-only credential, never create/model key.
export function maintenanceClient({endpoint,secret,fetchImpl=fetch}){
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/api/internal/mobile-maintenance'||typeof secret!=='string'||secret.length<32)throw Error('Fixed HTTPS maintenance endpoint and scoped secret required')
 return async()=>{
  const r=await fetchImpl(url,{method:'POST',headers:{authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(20000)})
  if(!r.ok)throw Error('Maintenance not confirmed')
  const body=await r.json();if(!body||!Number.isFinite(Date.parse(body.at))||Math.abs(Date.now()-Date.parse(body.at))>60000||!Number.isSafeInteger(body.cleanup?.deleted)||body.cleanup.deleted<0||!Number.isSafeInteger(body.cleanup?.unresolved)||body.cleanup.unresolved<0||!Number.isSafeInteger(body.uncertain?.unresolved)||body.uncertain.unresolved<0)throw Error('Fresh maintenance receipt required')
  return{deleted:body.cleanup.deleted,unresolved:body.cleanup.unresolved+body.uncertain.unresolved,uncertain:body.uncertain}
 }
}
