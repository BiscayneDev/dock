import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { preparePrivateTaskGit } from '../src/private-task-git.mjs'
const exec = promisify(execFile)
test('private git seeds only base snapshot, excluding sibling objects and refs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'private-git-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args) => exec('git', ['-C', root, ...args])
  await git('init', '-q'); await git('config', 'user.email', 'fixture@example.com'); await git('config', 'user.name', 'Fixture')
  await writeFile(join(root, 'base.txt'), 'shared base')
  await git('add', '-A'); await git('commit', '-qm', 'base')
  const base = (await git('rev-parse', 'HEAD')).stdout.trim()
  await git('checkout', '-qb', 'sibling-private')
  await writeFile(join(root, 'private.txt'), 'fictional sibling-private content')
  await git('add', '-A'); await git('commit', '-qm', 'private')
  const sibling = (await git('rev-parse', 'HEAD')).stdout.trim()
  const secretBlob = (await git('rev-parse', 'HEAD:private.txt')).stdout.trim()
  const isolated = await preparePrivateTaskGit(root, base, 'task-a')
  t.after(() => rm(isolated.scratch, { recursive: true, force: true }))
  const isoGit = (...args) => exec('git', [`--git-dir=${isolated.gitDir}`, ...args])
  assert.match((await isoGit('show', 'HEAD:base.txt')).stdout, /shared base/)
  await assert.rejects(isoGit('cat-file', '-p', secretBlob))
  await assert.rejects(isoGit('cat-file', '-p', sibling))
  assert.doesNotMatch((await isoGit('show-ref')).stdout, /sibling-private/)
  assert.equal((await isoGit('rev-list', '--all', '--count')).stdout.trim(), '1')
})
