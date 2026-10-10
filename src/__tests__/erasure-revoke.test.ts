import { describe,it,expect,vi,afterEach } from 'vitest'
import { revokeGoogleToken } from '@/lib/integrations/revoke'
afterEach(()=>vi.unstubAllGlobals())
describe('erasure provider revoke evidence',()=>{
 it('accepts success and explicit already-invalid token only',async()=>{
  const f=vi.fn().mockResolvedValueOnce(new Response('',{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({error:'invalid_token'}),{status:400}))
  vi.stubGlobal('fetch',f)
  expect(await revokeGoogleToken('ephemeral-test-value')).toBe('revoked');expect(await revokeGoogleToken('ephemeral-test-value')).toBe('revoked')
 })
 it('does not treat arbitrary 400 or transport failure as revoked',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'invalid_request'}),{status:400})).mockRejectedValueOnce(new Error('network')))
  expect(await revokeGoogleToken('ephemeral-test-value')).toBe('failed');expect(await revokeGoogleToken('ephemeral-test-value')).toBe('failed')
 })
})
