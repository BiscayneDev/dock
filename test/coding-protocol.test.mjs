import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCodingMessages } from '../lib/coding-protocol.ts'
const user = { role: 'user', content: 'fictional task' }
const assistant = { role: 'assistant', content: null, tool_calls: [{id:'c1',type:'function',function:{name:'read_file',arguments:'{"path":"a.txt"}'}}] }
const tool = {role:'tool',content:'fictional result',tool_call_id:'c1'}
test('coding protocol strips client system and provider knobs', () => {
 const result = parseCodingMessages({messages:[{role:'system',content:'untrusted instruction'},user,assistant,tool],model:'untrusted',baseURL:'https://untrusted.invalid',apiKey:'fictional'})
 assert.deepEqual(result,[user,assistant,tool])
})
test('coding protocol rejects unmatched, reused, unknown and unfinished tool calls', () => {
 for(const messages of [[user,tool],[user,assistant],[user,assistant,tool,assistant,tool],[user,{...assistant,tool_calls:[{...assistant.tool_calls[0],function:{name:'network_request',arguments:'{}'}}]},tool]]) assert.equal(parseCodingMessages({messages}),null)
})
test('coding protocol requires bounded valid message payload', () => {
 assert.equal(parseCodingMessages({messages:[user]}),null)
 assert.equal(parseCodingMessages({messages:[user,{role:'system',content:'late injected system'}]}),null)
 assert.equal(parseCodingMessages({messages:[user,{role:'assistant',content:'x'.repeat(240001)}]}),null)
})
