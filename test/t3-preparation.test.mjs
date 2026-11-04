import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {parsePreparation,prepareOwnerTask} from '../lib/t3-preparation.ts'
const input=()=>({runId:'11111111-1111-4111-8111-111111111111',baseSha:'a'.repeat(40),cleanupDeadline:new Date(Date.now()+600000).toISOString()})
test('preparation defaults disabled and requires owner session, never a token fallback',async()=>{
 let calls=0;const prepare=async()=>{calls++;return {id:'fixture'}}
 assert.equal((await prepareOwnerTask({enabled:false,ownerSession:null,input:input(),prepare})).status,501)
 assert.equal((await prepareOwnerTask({enabled:true,ownerSession:null,input:input(),prepare})).status,401)
 assert.equal(calls,0)
 const source=await readFile(new URL('../app/api/t3/preparations/route.ts',import.meta.url),'utf8')
 assert.match(source,/assistantContext\(\)/);assert.doesNotMatch(source,/import.*(resolveContext|adminClient|agentToken|mobileToken)/)
})
test('owner cannot submit execution or claimed authority fields',async()=>{
 for(const field of ['ownerId','workspaceId','projectId','executionId','supervised','launchAuthorized','apiKey','budget'])assert.equal(parsePreparation({...input(),[field]:'untrusted'}),null)
 for(const cleanupDeadline of [new Date(Date.now()-1).toISOString(),new Date(Date.now()+31*60000).toISOString(),'bad'])assert.equal(parsePreparation({...input(),cleanupDeadline}),null)
 assert.equal(parsePreparation({...input(),baseSha:'main'}),null)
})
test('valid owner preparation calls only scoped RPC inputs and disclaims launch',async()=>{
 const raw=input();let received
 const result=await prepareOwnerTask({enabled:true,ownerSession:{userId:'owner',workspaceId:'workspace'},input:raw,prepare:async p=>{received=p;return{id:'fictional'}}})
 assert.deepEqual(received,raw);assert.equal(result.status,200);assert.equal(result.body.executionCreated,false);assert.equal(result.body.launchAuthorized,false)
 const refused=await prepareOwnerTask({enabled:true,ownerSession:{userId:'owner',workspaceId:'workspace'},input:raw,prepare:async()=>{throw new Error('private database details')}})
 assert.equal(refused.status,409);assert.equal(JSON.stringify(refused).includes('private database details'),false)
})
