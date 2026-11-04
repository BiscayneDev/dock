// Experimental host runner. Every task has a private base-only git repository.
// No shared object store, refs, config, hooks or host credentials are mounted.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, constants } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { preparePrivateTaskGit } from './private-task-git.mjs'
import http from 'node:http'

export async function runConfinedCoding({ repo, taskRef, baseRef = 'HEAD', brief, infer, env = process.env }) {
  if (env.DOCK_ISOLATED_RUNTIME !== 'on') throw new Error('experimental isolated runtime disabled')
  const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find(existsSync)
  const docker = !bwrap && ['/usr/bin/docker', '/usr/local/bin/docker', '/usr/bin/podman'].find(existsSync)
  if (!bwrap && !docker) throw new Error('no supported enforcing runtime on this host (Linux bwrap or Docker/Podman required; Apple container socket sharing unverified)')
  // Detect an actually usable sandbox, not just an installed binary.
  if (bwrap) execFileSync(bwrap, ['--unshare-all', '--die-with-parent', '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib', ...(existsSync('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []), '--', '/bin/true'])
  const prepared = await preparePrivateTaskGit(repo, baseRef, taskRef)
  const { scratch, snapshotDir } = prepared
  const sock = join(scratch, 'inference.sock')
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return }
    try {
      let bytes = 0
      const chunks = []
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 1_000_000) throw new Error('request too large')
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      // Only the host-supplied inference callback can call outside the sandbox.
      const answer = await infer(body)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(answer))
    } catch { res.writeHead(502).end(JSON.stringify({ error: 'inference unavailable' })) }
  })
  const runner = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/isolated-coding-agent.mjs')
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(sock, resolve) })
    const args = [
      '--unshare-all', '--die-with-parent', '--clearenv', '--new-session',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib',
      ...(existsSync('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []),
      '--bind', scratch, scratch, '--ro-bind', runner, '/run/agent.mjs',
      '--bind', sock, '/run/inference.sock', '--chdir', snapshotDir,
      '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/tmp',
      '--setenv', 'DOCK_WORKTREE_PATH', snapshotDir, '--setenv', 'DOCK_TASK_BRIEF', brief,
      '--setenv', 'SHIPYARD_INFERENCE_URL', 'unix:///run/inference.sock',
      '--', process.execPath, '/run/agent.mjs',
    ]
    const dockerArgs = [
      'run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
      '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--tmpfs', '/tmp',
      '-v', `${scratch}:${scratch}`, '-v', `${runner}:/run/agent.mjs:ro`, '-v', `${sock}:/run/inference.sock`,
      '--workdir', snapshotDir, '-e', 'HOME=/tmp', '-e', `DOCK_WORKTREE_PATH=${snapshotDir}`,
      '-e', `DOCK_TASK_BRIEF=${brief}`, '-e', 'SHIPYARD_INFERENCE_URL=unix:///run/inference.sock',
      'node:22-bookworm', 'node', '/run/agent.mjs',
    ]
    const child = spawn(bwrap || docker, bwrap ? args : dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } })
    let logs = ''
    child.stdout.on('data', (c) => { logs = (logs + c).slice(-16000) })
    child.stderr.on('data', (c) => { logs = (logs + c).slice(-16000) })
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
    const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timer))
    // Agent status is untrusted output. Do NOT run host git with its metadata,
    // migrate objects, or advance any owner ref based on it.
    let raw = ''
    let statusHandle
    try {
      statusHandle = await open(join(snapshotDir, '.dock-agent-status.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const stat = await statusHandle.stat()
      if (stat.isFile() && stat.size <= 16000) raw = await statusHandle.readFile('utf8')
    } catch { /* untrusted status symlink or missing file */ }
    finally { await statusHandle?.close() }
    let status
    try { status = JSON.parse(raw) } catch { status = {} }
    return { outcome: exitCode === 0 && status.ok === true ? 'review_required' : 'failed', summary: String(status.summary ?? 'agent exited without result').slice(0, 1000), exitCode, logs, baseSha: prepared.baseSha, artifactPath: snapshotDir }
  } catch (error) {
    await rm(scratch, { recursive: true, force: true })
    throw error
  } finally {
    await new Promise((r) => server.close(r))
  }
}
