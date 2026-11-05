// Backend ONLY. Supabase client/service key never enters the private instance.
export function persistentT3Store(db){
 async function rpc(name,args){const{data,error}=await db.rpc(name,args);if(error)throw new Error('T3 persistent transition refused');return data}
 return{
 claimStep:(id,worker)=>rpc('claim_t3_step',{p_id:id,p_worker:worker}),
 releaseStep:t=>rpc('release_t3_step',{p_id:t.id,p_version:t.version,p_worker:t.worker}),
 claim:(id,worker)=>rpc('claim_t3_owner_task',{p_id:id,p_worker:worker}),
 advance:(t,next,patch={})=>rpc('advance_t3_owner_task',{p_id:t.id,p_version:t.version,p_worker:t.worker,p_next:next,p_patch:patch}),
 heartbeat:t=>rpc('heartbeat_t3_task',{p_id:t.id,p_version:t.version,p_worker:t.worker}),
 takeCleanup:(id,worker)=>rpc('take_t3_cleanup',{p_id:id,p_worker:worker}),
 async due(now=new Date().toISOString()){
 const{data,error}=await db.from('t3_owner_tasks').select('id').neq('phase','deleted').or(`cleanup_deadline.lte.${now},and(phase.neq.launched,lease_until.lte.${now})`).order('cleanup_deadline',{ascending:true}).limit(100)
 if(error)throw new Error('T3 cleanup query failed');return data
 },
 async runnable(){const{data,error}=await db.from('t3_owner_tasks').select('id').in('phase',['queued','ready','launched']).order('updated_at',{ascending:true}).limit(10);if(error)throw new Error('T3 steps unavailable');return data},
 async queued(){const{data,error}=await db.from('t3_owner_tasks').select('id').eq('phase','queued').order('created_at',{ascending:true}).limit(10);if(error)throw new Error('T3 queue unavailable');return data},
 async get(id){const{data,error}=await db.from('t3_owner_tasks').select('*').eq('id',id).single();if(error)throw new Error('T3 task unavailable');return data}
 }
}
