import {afterEach,describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/server',()=>({createServerClient:vi.fn()}))
import {listOwnedSites,ownerTag,revokeOwnedSite} from '@/lib/files/share'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
describe('hosted owner inventory',()=>{
 it('paginates orphan inventory, refuses shared/other-owner sites, verifies exact provider owner',async()=>{
  vi.stubEnv('HERENOW_API_KEY','unit-test-credential')
  const tag=`dinghy file · owner ${ownerTag('u')}`
  const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({scope:'all',publishes:[{slug:'mine-one',siteUrl:'https://mine-one.here.now/',ownership:'owned',displayDescription:tag},{slug:'other',siteUrl:'https://other.here.now/',ownership:'owned',displayDescription:'other owner'}],nextCursor:'second'})))
  .mockResolvedValueOnce(new Response(JSON.stringify({scope:'all',publishes:[{slug:'shared',siteUrl:'https://shared.here.now/',ownership:'shared',displayDescription:tag}],nextCursor:null})))
  vi.stubGlobal('fetch',f)
  expect(await listOwnedSites('u')).toEqual(['https://mine-one.here.now/']);expect(String(f.mock.calls[1][0])).toContain('cursor=second')
 })
 it('fails closed on malformed pagination contract',async()=>{vi.stubEnv('HERENOW_API_KEY','unit-test-credential');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({publishes:[]}))));await expect(listOwnedSites('u')).rejects.toThrow('schema')})
 it('rechecks ownership before orphan deletion and confirms 404 after',async()=>{
  vi.stubEnv('HERENOW_API_KEY','unit-test-credential')
  const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({displayDescription:`dinghy file · owner ${ownerTag('u')}`}))).mockResolvedValueOnce(new Response('')).mockResolvedValueOnce(new Response('',{status:404}))
  vi.stubGlobal('fetch',f);await revokeOwnedSite('https://mine-one.here.now/','u');expect(f.mock.calls[1][1].method).toBe('DELETE')
 })
 it('never deletes a different provider owner',async()=>{vi.stubEnv('HERENOW_API_KEY','unit-test-credential');const f=vi.fn(async()=>new Response(JSON.stringify({displayDescription:'other owner'})));vi.stubGlobal('fetch',f);await expect(revokeOwnedSite('https://mine-one.here.now/','u')).rejects.toThrow('owner_mismatch');expect(f).toHaveBeenCalledTimes(1)})
})
