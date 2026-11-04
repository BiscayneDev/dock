import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedKnowledgeContext, specialistBrief } from '../src/shared-knowledge.mjs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
test('shared context only exposes manifest-approved sources, not task-private nodes', async (t) => {
 const dir=await mkdtemp(join(tmpdir(),'shared-knowledge-')); t.after(()=>rm(dir,{recursive:true,force:true}))
 const manifest={createdAt:'fixture',files:[{source:'dock/code.ts',commit:'fixture-commit'}]}
 const graph={dock:{manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')},nodes:[{label:'budget approved',source_file:'dock/code.ts',source_location:'L2',_origin:'ast'},{label:'budget private sibling',source_file:'private/task-a/secret.txt'}]}
 await writeFile(join(dir,'graph.json'),JSON.stringify(graph)); await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest))
 const result=await sharedKnowledgeContext(dir,'budget'); assert.equal(result.sources.length,1); assert.equal(result.sources[0].source,'dock/code.ts')
 assert.match(specialistBrief('builder','fixture',result),/untrusted data/)
 assert.throws(()=>specialistBrief('admin','fixture',result),/unknown specialist/)
 graph.dock.manifestSha256='wrong'; await writeFile(join(dir,'graph.json'),JSON.stringify(graph))
 await assert.rejects(sharedKnowledgeContext(dir,'budget'),/manifest mismatch/)
})
