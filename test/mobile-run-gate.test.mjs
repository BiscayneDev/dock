import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source=await readFile(new URL('../app/api/runs/route.ts',import.meta.url),'utf8')
test('mobile run opt-in gate precedes all enqueue, and restricts mobile to text cloud runs',()=>{
 assert.ok(source.indexOf('process.env.DOCK_MOBILE_RUNS !== "on"')<source.indexOf('await enqueueRun('))
 assert.match(source,/mobileTokenHas\("runs:create"\)/)
 assert.match(source,/isMobile && \(target !== "cloud" \|\| body.isolatedTask !== undefined \|\| body.proposedAction !== undefined\)/)
})
