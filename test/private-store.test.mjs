import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, stat, symlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { privateStorePath, readPrivateStore, writePrivateStore } from '../lib/private-store.ts'

test('private state stays outside worktree with owner-only permissions and round trips', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dock-private-test-'))
  try {
    const cwd = path.join(root, 'repo'), home = path.join(root, 'home')
    await mkdir(cwd); await mkdir(home)
    const file = await privateStorePath(cwd, home)
    assert.ok(!file.startsWith(cwd + path.sep))
    assert.equal(await readPrivateStore(file), null)
    const synthetic = { oauth: { accessToken: 'synthetic-noncredential' } }
    await writePrivateStore(file, synthetic)
    assert.deepEqual(await readPrivateStore(file), synthetic)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700)
    await writePrivateStore(file, { payments: [] })
    assert.deepEqual(await readPrivateStore(file), { payments: [] })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects storage under application tree and symlink files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dock-private-test-'))
  try {
    await assert.rejects(privateStorePath(root, root), /outside/)
    const target = path.join(root, 'target'), link = path.join(root, 'link')
    await writeFile(target, '{}'); await symlink(target, link)
    await assert.rejects(readPrivateStore(link))
    await assert.rejects(writePrivateStore(link, {}), /Unsafe/)
    assert.equal(await readFile(target, 'utf8'), '{}')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Paybox store never loads old worktree credentials or silently falls back from KV', async () => {
  const source = await readFile(new URL('../lib/paybox.ts', import.meta.url), 'utf8')
  assert.ok(!source.includes('"data", "paybox.json"'))
  assert.ok(!source.includes('readFile(DATA_PATH'))
  const storeCode = source.slice(source.indexOf('async function readStore()'), source.indexOf('// ── In-app connection store helpers'))
  assert.ok(!storeCode.includes('catch'))
  assert.match(storeCode, /writePrivateStore/)
})
