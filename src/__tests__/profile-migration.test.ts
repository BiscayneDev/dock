import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
const sql = readFileSync('supabase/migrations/064_profile_files.sql', 'utf8')
describe('metadata-only file migration', () => {
  it('only adds file kind and revocation metadata', () => {
    expect(sql).toContain("kind in ('file','itinerary')")
    expect(sql).toContain('revoked_at timestamptz')
    expect(sql).not.toContain('create or replace function')
    expect(sql).not.toContain('source_key')
    expect(sql).not.toContain('insert into')
    expect(sql).not.toContain('delete from')
  })
})
