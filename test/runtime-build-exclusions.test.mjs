import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('server bundles exclude runtime user data without removing required Chromium assets', async () => {
  const config = await readFile(new URL('../next.config.ts', import.meta.url), 'utf8')
  for (const excluded of ['./data/**/*', './.data/**/*', './.config/**/*', './.env*']) assert.ok(config.includes(excluded))
  assert.match(config, /outputFileTracingExcludes/)
  assert.ok(config.includes('./node_modules/@sparticuz/chromium/bin/**/*'))
})
