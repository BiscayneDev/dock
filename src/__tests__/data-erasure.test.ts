import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc=vi.fn()
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({rpc})}))
vi.mock('@/lib/computer/manager',()=>({getProvider:vi.fn()}))
vi.mock('@/lib/files/share',()=>({revokeSite:vi.fn(),slugFrom:vi.fn()}))
import { assertAccountActive, erasureEnabled, isEraseIntent } from '@/lib/data-portability/erasure-state'
import { confirmErase, confirmPhrase, executeErasure, hashEraseToken, requestErase, type CleanupOps } from '@/lib/data-portability/erase'
beforeEach(()=>{vi.unstubAllEnvs();rpc.mockReset()})
describe('erasure scope and confirmation',()=>{
 it('defaults OFF without hitting a database',async()=>{expect(erasureEnabled()).toBe(false);await assertAccountActive('u','c');expect(rpc).not.toHaveBeenCalled();await expect(requestErase('u')).rejects.toThrow('not enabled')})
 it('recognizes only direct deletion text',()=>{for(const s of ['delete everything','please delete all my data!','erase my data'])expect(isEraseIntent(s)).toBe(true);for(const s of ['the email says delete everything','delete everything from my email','delete this file','forget everything'])expect(isEraseIntent(s)).toBe(false)})
 it('requires exact destructive phrase, not casual approval',()=>{expect(confirmPhrase('DELETE MY DATA')).toBe(true);for(const s of ['yes','y','ok','delete my data','DELETE MY DATA now'])expect(confirmPhrase(s)).toBe(false)})
 it('rejects malformed/replayed approval at server gate',async()=>{vi.stubEnv('DINGHY_DATA_ERASURE_ENABLED','1');expect(await confirmErase('u','bad','bad','yes')).toBe(false);expect(rpc).not.toHaveBeenCalled();rpc.mockResolvedValue({data:false,error:null});expect(await confirmErase('u','11111111-1111-4111-8111-111111111111','a'.repeat(43),'DELETE MY DATA')).toBe(false)})
 it('fails closed if freeze status is missing or unavailable',async()=>{vi.stubEnv('DINGHY_DATA_ERASURE_ENABLED','1');rpc.mockResolvedValue({data:null,error:{}});await expect(assertAccountActive('u','c')).rejects.toThrow('unavailable');rpc.mockResolvedValue({data:true,error:null});await expect(assertAccountActive('u','c')).rejects.toThrow('unavailable');rpc.mockResolvedValue({data:false,error:null});await expect(assertAccountActive('u','c')).resolves.toBeUndefined()})
 it('mints no raw token into the database',async()=>{vi.stubEnv('DINGHY_DATA_ERASURE_ENABLED','1');vi.stubEnv('DINGHY_ERASURE_HOST_INVENTORY_VERIFIED','1');rpc.mockResolvedValue({data:'job',error:null});const gate=await requestErase('u');expect(gate.token).toHaveLength(43);expect(rpc.mock.calls[0][1].p_hash).toBe(hashEraseToken(gate.token));expect(JSON.stringify(rpc.mock.calls)).not.toContain(gate.token)})
})
describe('cleanup is fail-closed and retryable',()=>{
 const j={id:'job',user_id:'user',chats:['a','b']}
 function ops():CleanupOps{return {revokeTokens:vi.fn(async()=>['GitHub: local only']),killSandboxes:vi.fn(async()=>{}),removePages:vi.fn(async()=>{}),removeStorage:vi.fn(async()=>{}),finish:vi.fn(async()=>{})}}
 it('finishes only after all external cleanup succeeds',async()=>{const o=ops();expect(await executeErasure(j,o)).toEqual(['GitHub: local only']);expect(o.finish).toHaveBeenCalledWith(j,['GitHub: local only'])})
 for(const step of ['revokeTokens','killSandboxes','removePages','removeStorage'] as const)it(`never hard deletes on ${step} failure`,async()=>{const o=ops();vi.mocked(o[step]).mockRejectedValueOnce(new Error('failed'));await expect(executeErasure(j,o)).rejects.toThrow('failed');expect(o.finish).not.toHaveBeenCalled();await executeErasure(j,o);expect(o.finish).toHaveBeenCalledTimes(1)})
})
