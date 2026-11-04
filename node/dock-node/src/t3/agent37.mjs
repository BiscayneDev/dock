// Backend-only Agent37 transport. Never sends workspace key in exec bodies/env.
// No retries for writes. Caller owns persisted intent and separate cleanup sweep.
export function agent37Provisioner({apiKey,enabled=false,fetchImpl=fetch,bootstrap,sourceSnapshot,modelCreditMicros=0,budgetForTask,template}){
 const id=x=>{if(!/^[a-z0-9]{1,64}$/.test(x??''))throw new Error('invalid instance');return x}
 async function request(path,{method='GET',body,exec=false}={}){
  if(!enabled||!apiKey)throw new Error('Agent37 transport disabled')
  const r=await fetchImpl((exec?'https://sandbox.agent37.app/v1':'https://api.agent37.com/v1')+path,{method,headers:{[exec?'X-Agent37-Key':'Authorization']:exec?apiKey:`Bearer ${apiKey}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(exec?60000:30000)})
  if(r.status===404)return null
  if(!r.ok)throw new Error(`Agent37 response uncertain/refused (${r.status})`)
  return r.json()
 }
 async function exec(instance,command){const data=await request(`/instances/${id(instance)}/exec`,{method:'POST',exec:true,body:{command}});if(data?.exit_code!==0||data.truncated)throw new Error('Private execution failed');return data}
 return{
  async create({task,name}){
   if(typeof template!=='string'||!/^dock-t3-[a-z0-9-]+@[1-9][0-9]*$/.test(template))throw new Error('Pinned reviewed administrator-policy template required')
   const credit=budgetForTask?await budgetForTask(task):modelCreditMicros
   if(!Number.isSafeInteger(credit)||credit<0)throw new Error('invalid model budget')
   const result=await request('/instances',{method:'POST',body:{template,name,metadata:{dock_task_id:task.id,dock_owner_id:task.owner_id},resources:{cpu:2,memory:4,disk:4},type:'default',region:'us',budget:{monthly_cap_micros:0,credit_micros:credit},public_ports:[],auto_sleep:true,idle_timeout_seconds:300}})
   return{id:id(result?.id)}
  },
  async prepare({task}){
   // Both callbacks are trusted backend configuration, never caller/model paths.
   // Snapshot reader must export only selected committed base, no .git/env/history.
   const snapshot=await sourceSnapshot(task)
   if(snapshot.baseSha!==task.base_sha||snapshot.repoKey!==task.repo_key)throw new Error('registered base snapshot mismatch')
   const command=await bootstrap({task,snapshot})
   if(typeof command!=='string'||!command.trim()||command.includes(apiKey))throw new Error('unsafe bootstrap')
   const result=await exec(task.execution_id,command)
   const binding=JSON.parse(result.stdout)
   if(binding.executionId!==task.execution_id||binding.baseSha!==task.base_sha||binding.policyRootOwned!==true||binding.policyReadOnlyToAgent!==true)throw new Error('verified admin policy bootstrap required')
   return binding
  },
  async cli({task,args,stdin}){
   if(!args.every(x=>typeof x==='string'&&x.length<2048)||typeof stdin!=='string'||stdin.length>10000)throw new Error('invalid CLI request')
   const quote=x=>"'"+x.replaceAll("'","'\\''")+"'"
   const command=`printf %s ${quote(Buffer.from(stdin).toString('base64'))} | base64 -d | /opt/dock-t3-runtime/t3 ${args.map(quote).join(' ')}`
   const data=await exec(task.execution_id,command);return{code:0,stdout:data.stdout}
  },
  async find({name,executionId}){
   const data=await request('/instances');if(data?.has_more||data?.next_cursor||data?.pagination?.has_more||!Array.isArray(data?.data))throw new Error('inventory unavailable')
   const matched=data.data.filter(x=>x.name===name||x.id===executionId)
   if(matched.some(x=>x.name!==name))throw new Error('execution ownership mismatch')
   return matched.filter(x=>x.status!=='deleted').map(x=>({id:id(x.id),name:x.name}))
  },
  async delete(instance){const result=await request(`/instances/${id(instance)}`,{method:'DELETE'});if(result!==null&&result.deleted!==true)throw new Error('delete unverified')},
  // DELETE is documented to settle final compute. Confirm absence, not stop/sleep.
  async settled({task,deletedIds=[]}){const ids=[...new Set([task.execution_id,...deletedIds].filter(Boolean))];if(!ids.length)return false;for(const instance of ids)if(await request(`/instances/${id(instance)}`)!==null)return false;return true}
 }
}
