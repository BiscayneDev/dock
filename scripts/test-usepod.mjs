// Quick smoke test: prove Dock's getLLMProvider() routes through UsePod and
// the response makes it back. Run from the dock repo root:
//
//   LLM_PROVIDER=usepod USEPOD_TOKEN=<your-uuid> \
//     node --import tsx scripts/test-usepod.mjs
//
// Then check https://usepod.ai/dashboard — the balance should debit.

const { getLLMProvider } = await import('../src/lib/llm/index.ts')

console.log(`[test-usepod] LLM_PROVIDER=${process.env.LLM_PROVIDER ?? '(unset)'}`)
console.log(`[test-usepod] USEPOD_TOKEN=${process.env.USEPOD_TOKEN ? '(set)' : '(unset)'}`)
console.log('[test-usepod] Calling getLLMProvider().chat(...)...\n')

const provider = getLLMProvider()
const start = Date.now()

const response = await provider.chat({
  system: 'You are a helpful assistant. Reply in one sentence.',
  messages: [
    {
      role: 'user',
      content: 'In one sentence, what is the capital of France?',
    },
  ],
  tools: [],
})

const elapsed = Date.now() - start
console.log(`[test-usepod] Response in ${elapsed}ms:`)
console.log(`  content:   ${response.content}`)
console.log(`  stopReason: ${response.stopReason}`)
console.log(`  toolCalls: ${response.toolCalls.length}`)
console.log('\n[test-usepod] Check https://usepod.ai/dashboard — balance should now show a debit.')
