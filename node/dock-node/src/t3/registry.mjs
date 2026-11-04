// Host-only durable correlation. Never mount this directory into execution.
import { mkdir, open, readFile, rename, rm, lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { constants } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/
export class TaskRegistry {
 constructor(directory) { this.directory=resolve(directory) }
 async transact(fn) {
  await mkdir(this.directory,{recursive:true,mode:0o700})
  const stat=await lstat(this.directory)
  if(stat.isSymbolicLink() || (process.getuid && stat.uid!==process.getuid()) || await realpath(this.directory)!==this.directory || (stat.mode&0o077)) throw new Error('unsafe registry directory')
  const lock=join(this.directory,'lock')
  // No stale-lock stealing: a killed writer requires explicit host recovery.
  await mkdir(lock,{mode:0o700}).catch(()=>{throw new Error('registry locked; host reconciliation required')})
  let temp
  try {
   let rows=[]
   try {const f=await open(join(this.directory,'tasks.json'),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.nlink!==1||(s.mode&0o077)||(process.getuid&&s.uid!==process.getuid()))throw new Error('unsafe registry file');rows=JSON.parse(await f.readFile('utf8'))}finally{await f.close()}}catch(e){if(e.code!=='ENOENT')throw e}
   if(!Array.isArray(rows))throw new Error('invalid registry')
   const result=await fn(rows)
   temp=join(this.directory,randomUUID()+'.tmp')
   const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(rows));await f.sync()}finally{await f.close()}
   await rename(temp,join(this.directory,'tasks.json'));temp=null
   const d=await open(this.directory,'r');try{await d.sync()}finally{await d.close()}
   return structuredClone(result)
  } finally {if(temp)await rm(temp,{force:true});await rm(lock,{recursive:true})}
 }
 async reserve(input) {
  for(const k of ['ownerId','workspaceId','projectId','taskRef','executionId'])if(!ID.test(input[k]??''))throw new Error('invalid task identity')
  if(!/^[a-f0-9]{40}$/.test(input.baseSha??'') || !Number.isFinite(input.deadlineMs) || input.deadlineMs<=Date.now())throw new Error('resolved base and future cleanup deadline required')
  return this.transact(rows=>{
   if(rows.some(r=>r.taskRef===input.taskRef&&r.ownerId===input.ownerId) || rows.some(r=>r.executionId===input.executionId))throw new Error('task or private execution already reserved')
   const row={ownerId:input.ownerId,workspaceId:input.workspaceId,projectId:input.projectId,taskRef:input.taskRef,executionId:input.executionId,baseSha:input.baseSha,deadlineMs:input.deadlineMs,state:'reserved',version:1,threadId:null,runId:null,createdAt:new Date().toISOString()};rows.push(row);return row
  })
 }
 async get(scope){return this.transact(rows=>this.find(rows,scope))}
 find(rows,scope){const r=rows.find(r=>['ownerId','workspaceId','projectId','taskRef','executionId'].every(k=>r[k]===scope[k]));if(!r)throw new Error('task scope mismatch');return r}
 async transition(scope,expected,next,patch={}) {
  const allowed={reserved:['launching','cleanup_due'],launching:['launched','uncertain','cleanup_due'],launched:['review_required','waiting','failed','uncertain','cleanup_due'],waiting:['cleanup_due'],review_required:['cleanup_due'],failed:['cleanup_due'],uncertain:['cleanup_due'],cleanup_due:['deleted']}
  return this.transact(rows=>{const r=this.find(rows,scope);if(r.version!==expected||!allowed[r.state]?.includes(next))throw new Error('stale or invalid transition')
   if(next!=='launched'&&Object.keys(patch).some(k=>k!=='artifactSha256'))throw new Error('launch mapping immutable')
   if(Object.keys(patch).some(k=>!['threadId','runId','artifactSha256','baseDir','contextSha256'].includes(k)))throw new Error('immutable owner mapping')
   if(patch.threadId!=null&&(typeof patch.threadId!=='string'||patch.threadId.length>256))throw new Error('invalid thread')
   if(patch.runId!=null&&(typeof patch.runId!=='string'||patch.runId.length>512))throw new Error('invalid run')
   if(patch.baseDir!=null&&(typeof patch.baseDir!=='string'||!/^\/[a-zA-Z0-9/_-]+$/.test(patch.baseDir)||patch.baseDir.includes('..')))throw new Error('invalid base directory')
   if(patch.contextSha256!=null&&!/^[a-f0-9]{64}$/.test(patch.contextSha256))throw new Error('invalid context hash')
   if(patch.artifactSha256!=null&&!/^[a-f0-9]{64}$/.test(patch.artifactSha256))throw new Error('invalid artifact hash')
   if(next==='launched'&&(!patch.threadId||!patch.runId))throw new Error('launch correlation required')
   Object.assign(r,patch,{state:next,version:r.version+1});return r})
 }
 async archive(scope,artifact){
  return this.transact(async rows=>{this.find(rows,scope);const content=JSON.stringify(artifact),sha256=createHash('sha256').update(content).digest('hex');const file=join(this.directory,sha256+'.artifact.json');let f;try{f=await open(file,'wx',0o600);await f.writeFile(content);await f.sync()}catch(e){if(e.code!=='EEXIST')throw e;const existing=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(await existing.readFile('utf8')!==content)throw new Error('artifact collision')}finally{await existing.close()}}finally{await f?.close()}return sha256})
 }
 async due(now=Date.now()){return this.transact(rows=>rows.filter(r=>r.state!=='deleted'&&r.deadlineMs<=now))}
}
