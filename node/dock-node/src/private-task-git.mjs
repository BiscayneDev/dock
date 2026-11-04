// Host preparation only. A task receives one selected base snapshot, never the
// shared object database, refs, hooks, configuration, credentials or history.
// Commits stay in this private repository for review; no agent-supplied objects
// or status file are imported into the owner's repository.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const exec = promisify(execFile)
export async function preparePrivateTaskGit(repo, baseRef, taskRef) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,100}$/.test(baseRef) || baseRef.includes('..')) throw new Error('invalid base ref')
  if (!/^task-[a-z0-9][a-z0-9-]{0,62}$/.test(taskRef)) throw new Error('invalid task ref')
  const scratch = await mkdtemp(join(tmpdir(), 'dock-private-'))
  const seed = join(scratch, 'seed')
  await mkdir(seed)
  try {
    const { stdout: base } = await exec('git', ['-C', repo, 'rev-parse', '--verify', `${baseRef}^{commit}`])
    const baseSha = base.trim()
    const { stdout: archive } = await exec('git', ['-C', repo, 'archive', '--format=tar', baseSha], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    const archivePath = join(scratch, 'base.tar')
    await writeFile(archivePath, archive)
    await exec('tar', ['-xf', archivePath, '-C', seed, '--no-same-owner'])
    await rm(archivePath)
    await exec('git', ['init', '-q', '--template=', '--initial-branch', `dock/${taskRef}`, seed])
    const env = { PATH: process.env.PATH, HOME: scratch, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Dock snapshot', GIT_AUTHOR_EMAIL: 'snapshot@localhost', GIT_COMMITTER_NAME: 'Dock snapshot', GIT_COMMITTER_EMAIL: 'snapshot@localhost' }
    await exec('git', ['-C', seed, 'add', '-A'], { env })
    await exec('git', ['-C', seed, 'commit', '-q', '--allow-empty', '-m', `Base snapshot ${baseSha}`], { env })
    // Eliminate host configuration and hooks from all subsequent child git use.
    await writeFile(join(seed, '.git', 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n[user]\nname = Dock task\nemail = task@localhost\n')
    const taskDir = join(scratch, taskRef)
    await exec('git', ['-C', seed, 'worktree', 'add', '-q', '-b', `dock/run-${taskRef}`, taskDir], { env })
    return { scratch, gitDir: join(seed, '.git'), baseSha, snapshotDir: taskDir, privateRepo: seed }
  } catch (error) {
    await rm(scratch, { recursive: true, force: true })
    throw error
  }
}
