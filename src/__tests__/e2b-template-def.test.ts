import { describe, it, expect } from 'vitest'
// @ts-expect-error plain .mjs script, no types
import { buildTemplateDefinition, REPO_ROOT } from '../../scripts/e2b-template-def.mjs'
import { Template } from 'e2b'
import fs from 'node:fs'
import path from 'node:path'

describe('E2B template definition', () => {
  it('resolves the bootstrap file from the repo root, regardless of cwd', async () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/lib/computer/bootstrap.py'))).toBe(true)
    // computeHashes reads the copied files; it throws "No files found" if the
    // context path is wrong (the bug when run from scripts/ or the repo root).
    const json = await Template.toJSON(buildTemplateDefinition(), true)
    expect(json).toContain('/tmp/dinghy-bootstrap.py')
    expect(json).toContain('filesHash')
  })
})
