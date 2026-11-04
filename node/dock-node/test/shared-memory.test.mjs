import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm,readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { proposeSharedFact,promoteSharedFact } from '../src/shared-memory.mjs'
test('task memory remains proposed until host verifies sources; promotion is exclusive',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-proof-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const id=await proposeSharedFact(dir,{taskRef:'task-fixture',text:'Fictional source-linked finding',sources:[{source:'dock/src/example.ts',commit:'a'.repeat(40)}]})
 assert.equal((await readdir(dir)).some((x)=>x.endsWith('.approved.json')),false)
 await assert.rejects(promoteSharedFact(dir,id,{sourceVerified:false,hostReviewer:'fixture'}),/host source review/)
 const record=await promoteSharedFact(dir,id,{sourceVerified:true,hostReviewer:'fixture-reviewer'})
 assert.equal(record.state,'approved')
 await assert.rejects(promoteSharedFact(dir,id,{sourceVerified:true,hostReviewer:'fixture-reviewer'}),/EEXIST/)
})
