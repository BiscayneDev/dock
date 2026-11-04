// Fictional control-plane HTTP contract -> normal device API client -> executor
// -> real confined coding child -> HTTP inference relay -> completion callback.
// This does not claim the production coding-inference endpoint is enabled.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { createApi } from '../src/api.mjs'
import { executeRun } from '../src/executor.mjs'
import { runIsolatedAgentTask } from '../src/isolated-agent.mjs'
const exec = promisify(execFile)
test('fictional HTTP home run traverses API client, executor and real sandbox to review result', { skip: !existsSync('/usr/bin/bwrap'), timeout: 60000 }, async (t) => {
 const root = await mkdtemp(join(tmpdir(), 'home-http-'))
 t.after(() => rm(root, { recursive: true, force: true }))
 const repo = join(root, 'fixture')
 await exec('mkdir', ['-p', repo])
 const git = (...args) => exec('git', ['-C', repo, ...args])
 await git('init', '-q'); await git('config', 'user.email', 'fixture@example.com'); await git('config', 'user.name', 'Fixture')
 await writeFile(join(repo, 'base.txt'), 'base'); await git('add', '-A'); await git('commit', '-qm', 'base')
 const base = (await git('rev-parse', 'HEAD')).stdout.trim()
 const steps = [['write_file', {path:'feature.txt', content:'fictional result'}], ['run_shell', {command:'git add feature.txt'}], ['run_shell', {command:'git commit -m feature'}], ['finish', {summary:'Ready for review, not merged'}]]
 let step = 0, completed
 const server = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer fictional-device-token')
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/api/devices/claim') res.end(JSON.stringify({run:{id:'fictional-run', isolatedTask:{repoKey:'fixture', taskRef:'task-fixture', baseRef:base, brief:'Implement fictional feature'}}}))
  else if (req.url === '/api/devices/infer') {
   assert.equal(body.run_id, 'fictional-run'); assert.ok(body.coding.messages)
   const [name, args] = steps[step++]
   res.end(JSON.stringify({choices:[{message:{role:'assistant', content:null, tool_calls:[{id:`c${step}`, type:'function', function:{name, arguments:JSON.stringify(args)}}]}}]}))
  } else if (req.url.endsWith('/complete')) { completed=body; res.end('{}') }
  else res.end('{}')
 })
 await new Promise((r) => server.listen(0, '127.0.0.1', r))
 t.after(() => new Promise((r) => server.close(r)))
 const api = createApi({server:`http://127.0.0.1:${server.address().port}`, token:'fictional-device-token'})
 const old = process.env.DOCK_ISOLATED_RUNTIME; process.env.DOCK_ISOLATED_RUNTIME='on'
 let result
 try {
  result = await executeRun(await api.claim(), {api, isolatedRunner: (params) => runIsolatedAgentTask({...params, registeredRepos:[repo]})})
 } finally { if (old === undefined) delete process.env.DOCK_ISOLATED_RUNTIME; else process.env.DOCK_ISOLATED_RUNTIME=old }
 assert.equal(result.outcome, 'review_required')
 assert.equal(completed.status, 'succeeded')
 assert.match(completed.output, /Ready for review/)
 assert.equal(await readFile(join(result.artifactPath,'feature.txt'),'utf8'),'fictional result')
 assert.equal((await git('rev-parse','HEAD')).stdout.trim(),base)
 t.after(() => rm(join(result.artifactPath,'..'),{recursive:true,force:true}))
})
