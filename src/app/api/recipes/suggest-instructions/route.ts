import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { getLLMProvider } from '@/lib/llm/index'

const SuggestBody = z.object({
  trigger_type: z.string(),
  trigger_config: z.record(z.string(), z.unknown()),
  name: z.string().optional(),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = SuggestBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const llm = getLLMProvider()

  const response = await llm.chat({
    system: `You write instructions for an AI automation agent called Dock. Given a trigger type and configuration, suggest clear, specific instructions for what the agent should do when the trigger fires. Be concise but thorough. Write in second person imperative ("Summarize my...", "Check for...", "Create a...").`,
    messages: [
      {
        role: 'user',
        content: `Trigger type: ${parsed.data.trigger_type}\nTrigger config: ${JSON.stringify(parsed.data.trigger_config)}\n${parsed.data.name ? `Recipe name: ${parsed.data.name}` : ''}`,
      },
    ],
    tools: [],
    maxTokens: 500,
  })

  return NextResponse.json({ instructions: response.content ?? '' })
}
