import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'
import { runConfinedCoding } from '../src/confined-coding.mjs'
const exec = promisify(execFile)
test('real confined processes: separate base-only git repositories, denied sibling reads and network, no host ref import', { skip: !existsSync('/usr/bin/bwrap'), timeout: 60000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'coding-proof-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const git = (...args) => exec('git', ['-C', dir, ...args])
  await git('init', '-q'); await git('config', 'user.email', 'fixture@example.com'); await git('config', 'user.name', 'Fixture')
  let hits = 0
  const canary = http.createServer((req, res) => { hits++; res.end('unexpected') })
  await new Promise((r) => canary.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => canary.close(r)))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node probe.cjs' } }))
  await writeFile(join(dir, 'probe.cjs'), `const fs = require('fs'); const net = require('net');
const out = {key: !!process.env.SHIPYARD_INFERENCE_API_KEY, siblingReadable: false};
try { fs.readFileSync(${JSON.stringify(join(dir, 'private.txt'))}); out.siblingReadable = true } catch {}
try { fs.writeFileSync(${JSON.stringify(join(dir, 'escape.txt'))}, 'escape'); out.hostWrite = true } catch { out.hostWrite = false }
fetch('http://127.0.0.1:${canary.address().port}/').then(()=>out.network=true).catch(()=>out.network=false).finally(()=>fs.writeFileSync('proof.json', JSON.stringify(out)));
`)
  await git('add', '-A'); await git('commit', '-qm', 'base')
  const base = (await git('rev-parse', 'HEAD')).stdout.trim()
  await git('checkout', '-qb', 'sibling-private')
  await writeFile(join(dir, 'private.txt'), 'fictional private sibling')
  await git('add', '-A'); await git('commit', '-qm', 'private sibling')
  const siblingSha = (await git('rev-parse', 'HEAD')).stdout.trim()
  const blob = (await git('rev-parse', 'HEAD:private.txt')).stdout.trim()
  const results = await Promise.all(['a', 'b'].map(async (id) => {
    const steps = [
      ['run_shell', { command: 'npm test' }],
      ['run_shell', { command: `git log --all --oneline` }],
      ['read_file', { path: '/etc/passwd' }],
      ['write_file', { path: `hello-${id}.txt`, content: `by ${id}` }],
      ['run_shell', { command: `git add hello-${id}.txt` }],
      ['run_shell', { command: `git commit -m TASK_${id}` }],
      ['finish', { summary: `task ${id} ready for review` }],
    ]
    let step = 0
    const result = await runConfinedCoding({ repo: dir, taskRef: `task-${id}`, baseRef: base, brief: `Build fictional task ${id}`, env: { DOCK_ISOLATED_RUNTIME: 'on', SHIPYARD_INFERENCE_API_KEY: 'fictional-key-not-to-pass' }, infer: async (body) => {
      const [name, args] = steps[step++]
      return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }
    } })
    t.after(() => rm(join(result.artifactPath, '..'), { recursive: true, force: true }))
    assert.equal(result.outcome, 'review_required', result.logs)
    const proof = JSON.parse(await readFile(join(result.artifactPath, 'proof.json'), 'utf8'))
    assert.deepEqual(proof, { key: false, siblingReadable: false, hostWrite: false, network: false })
    await assert.rejects(exec('git', ['-C', result.artifactPath, 'cat-file', '-p', blob]))
    await assert.rejects(exec('git', ['-C', result.artifactPath, 'cat-file', '-p', siblingSha]))
    assert.equal(await readFile(join(result.artifactPath, `hello-${id}.txt`), 'utf8'), `by ${id}`)
    return result
  }))
  assert.notEqual(results[0].artifactPath, results[1].artifactPath)
  assert.equal(hits, 0)
  assert.equal((await git('rev-parse', 'HEAD')).stdout.trim(), siblingSha)
  assert.equal((await git('show-ref')).stdout.includes('dock/task-'), false)
})
