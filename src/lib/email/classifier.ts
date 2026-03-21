import { getLLMProvider } from '@/lib/llm/index'

export interface EmailClassification {
  urgency: 'critical' | 'high' | 'normal' | 'low'
  requiresAction: boolean
  isOTP: boolean
  summary: string
  category: 'personal' | 'work' | 'transactional' | 'newsletter' | 'spam'
}

export async function classifyEmail(email: {
  from: string
  subject: string
  snippet: string
}): Promise<EmailClassification> {
  const llm = getLLMProvider()

  const response = await llm.chat({
    system: `You classify emails. Respond with ONLY valid JSON matching this schema:
{
  "urgency": "critical" | "high" | "normal" | "low",
  "requiresAction": boolean,
  "isOTP": boolean,
  "summary": "one sentence summary",
  "category": "personal" | "work" | "transactional" | "newsletter" | "spam"
}

Rules:
- "critical": OTP codes, security alerts, time-sensitive deadlines within hours
- "high": direct emails from real people requiring response, meeting changes
- "normal": standard work emails, updates
- "low": newsletters, marketing, automated notifications
- isOTP: true if the email contains a verification code, OTP, or login link
- Keep summary under 100 chars`,
    messages: [
      {
        role: 'user',
        content: `From: ${email.from}\nSubject: ${email.subject}\nPreview: ${email.snippet}`,
      },
    ],
    tools: [],
    maxTokens: 200,
  })

  try {
    const text = response.content ?? '{}'
    // Extract JSON from potential markdown code blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return defaultClassification(email)
    }
    return JSON.parse(jsonMatch[0]) as EmailClassification
  } catch {
    return defaultClassification(email)
  }
}

function defaultClassification(email: { subject: string }): EmailClassification {
  return {
    urgency: 'normal',
    requiresAction: false,
    isOTP: false,
    summary: email.subject,
    category: 'work',
  }
}
