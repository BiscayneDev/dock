// Only a one-execution capability is installed in the private runtime. This
// client has no owner approval, controller operation or business-write method.
export function executionMemoryClient({url,token,fetchImpl=fetch}){
 const base=new URL(url);if(base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw Error('HTTPS memory service required')
 async function call(operation,content,noteId){const r=await fetchImpl(new URL('/api/internal/execution-memory',base),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({operation,content,...noteId?{noteId}:{}}),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Execution memory refused');return(await r.json()).result}
 return{recall:query=>call('recall',query),note:content=>call('note',content),distill:(noteId,content)=>call('distill',content,noteId)}
}
