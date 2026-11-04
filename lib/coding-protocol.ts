// Narrow OpenAI-compatible coding protocol. Caller-supplied URLs, credentials,
// models, tool schemas and token limits are never forwarded to a provider.
export interface CodingMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}
const NAMES = new Set(['read_file', 'write_file', 'list_files', 'run_shell', 'finish'])
export function parseCodingMessages(raw: unknown): CodingMessage[] | null {
  if (!raw || typeof raw !== 'object') return null
  const input = (raw as Record<string, unknown>).messages
  if (!Array.isArray(input) || input.length < 2 || input.length > 80 || JSON.stringify(input).length > 240000) return null
  const result: CodingMessage[] = []
  const pending = new Set<string>()
  const used = new Set<string>()
  for (let i = 0; i < input.length; i++) {
    const x = input[i]
    if (!x || typeof x !== 'object') return null
    if (i === 0 && x.role === 'system') continue // host creates its own system instruction
    if (!['user', 'assistant', 'tool'].includes(x.role)) return null
    if (x.content !== null && typeof x.content !== 'string') return null
    const out: CodingMessage = { role: x.role, content: x.content }
    if (x.role === 'tool') {
      if (typeof x.tool_call_id !== 'string' || !pending.delete(x.tool_call_id)) return null
      out.tool_call_id = x.tool_call_id
    } else {
      if (pending.size) return null
      if (x.tool_calls !== undefined) {
        if (x.role !== 'assistant' || !Array.isArray(x.tool_calls) || x.tool_calls.length < 1 || x.tool_calls.length > 8) return null
        out.tool_calls = []
        for (const call of x.tool_calls) {
          if (!call || typeof call.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(call.id) || used.has(call.id) || call.type !== 'function') return null
          if (!call.function || !NAMES.has(call.function.name) || typeof call.function.arguments !== 'string' || call.function.arguments.length > 64000) return null
          try { const args = JSON.parse(call.function.arguments); if (!args || typeof args !== 'object' || Array.isArray(args)) return null } catch { return null }
          pending.add(call.id); used.add(call.id)
          out.tool_calls.push({ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } })
        }
      }
    }
    result.push(out)
  }
  if (pending.size || result[0]?.role !== 'user') return null
  return result
}
