import { z } from 'zod'
import {
  getPayboxClient,
  isPayboxConnected,
  payboxRequired,
  type PayboxEnvelope,
} from '@/lib/integrations/paybox'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

// Paybox — passkey-gated payments and secrets for the agent.
// Phase 1: list credentials, request a one-time virtual card, reveal a secret,
// and poll a pending request. Wallet signing / swaps need an in-process signing
// key (Phase 2) and are intentionally not exposed yet.

function getClient(ctx: UserContext): ReturnType<typeof getPayboxClient> {
  return getPayboxClient(ctx.tokens.paybox, ctx.userId)
}

// Map a Paybox result envelope to a ToolResult. The submit-once-then-poll rule
// means anything not yet terminal returns success:true with instructions to
// surface the approval URL and poll paybox_get_request — never re-call the
// original write tool.
function fromEnvelope(env: PayboxEnvelope): ToolResult {
  switch (env.status) {
    case 'success':
      return { success: true, data: { status: 'success', output: env.output } }
    case 'pending_approval':
      return {
        success: true,
        data: {
          status: 'pending_approval',
          request_id: env.request_id,
          approval_url: env.approval_url,
          instruction:
            'Ask the user to approve this in the Paybox app at approval_url ' +
            '(passkey required), then call paybox_get_request with request_id. ' +
            'Do NOT re-issue this request.',
        },
      }
    case 'pending_signature':
      return {
        success: true,
        data: {
          status: 'pending_signature',
          request_id: env.request_id,
          instruction:
            'Cleared; the signing window is producing the artifact. Poll ' +
            'paybox_get_request with request_id until it reaches success.',
        },
      }
    case 'denied':
      return { success: false, error: `Denied: ${env.reason ?? 'no reason given'}` }
    case 'error':
      return { success: false, error: env.message ?? 'Paybox returned an error' }
    default:
      // Non-enveloped payloads (e.g. an already-resolved get_request) pass through.
      return { success: true, data: env }
  }
}

function toError(err: unknown): ToolResult {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

// --- paybox_list_credentials ---

export const payboxListCredentials: Tool = {
  name: 'paybox_list_credentials',
  description:
    'List the Paybox credentials this agent may use (cards, wallets, secrets). ' +
    'Call this first — every other Paybox tool takes a credential_id from here.',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('listing Paybox credentials')
    try {
      const data = await getClient(ctx).listCredentials()
      return { success: true, data }
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_request_payment ---

const PaymentInput = z.object({
  credentialId: z.string().describe('A card-kind credential_id from paybox_list_credentials'),
  merchant: z.string().describe('Merchant identifier, shown to the user at approval'),
  merchantUrl: z.string().describe('The real HTTPS merchant origin the one-time card is bound to'),
  amountCents: z.number().int().describe('Amount in cents'),
  currency: z.string().default('USD').describe('ISO 4217 currency (USD only for now)'),
})

export const payboxRequestPayment: Tool = {
  name: 'paybox_request_payment',
  description:
    'Issue a merchant-scoped, one-time virtual card from a Paybox card credential. ' +
    'This does NOT charge the merchant — use the returned card at the merchant checkout. ' +
    'May require the user to approve with a passkey (pending_approval); then poll paybox_get_request.',
  inputSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'Card credential_id' },
      merchant: { type: 'string', description: 'Merchant identifier' },
      merchantUrl: { type: 'string', description: 'Real HTTPS merchant origin' },
      amountCents: { type: 'integer', description: 'Amount in cents' },
      currency: { type: 'string', description: 'ISO 4217 (USD only)' },
    },
    required: ['credentialId', 'merchant', 'merchantUrl', 'amountCents'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('making a payment')
    try {
      const p = PaymentInput.parse(input)
      const env = await getClient(ctx).requestPayment({
        credential_id: p.credentialId,
        merchant: p.merchant,
        merchant_url: p.merchantUrl,
        amount_cents: p.amountCents,
        currency: p.currency,
      })
      return fromEnvelope(env)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_request_secret ---

const SecretInput = z.object({
  credentialId: z.string().describe('A secret-kind credential_id from paybox_list_credentials'),
  raw: z
    .boolean()
    .default(false)
    .describe('false (default) returns a one-time secret_token; true returns plaintext if the grant allows'),
  purpose: z.string().optional().describe('Why the secret is needed, shown at approval'),
})

export const payboxRequestSecret: Tool = {
  name: 'paybox_request_secret',
  description:
    'Reveal a Paybox secret credential (e.g. an API key) so the agent can use it. ' +
    'Prefer raw=false so the plaintext never transits the model. ' +
    'May require passkey approval (pending_approval); then poll paybox_get_request.',
  inputSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'Secret credential_id' },
      raw: { type: 'boolean', description: 'false = one-time token (preferred); true = plaintext' },
      purpose: { type: 'string', description: 'Why the secret is needed' },
    },
    required: ['credentialId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('using a stored secret')
    try {
      const p = SecretInput.parse(input)
      const env = await getClient(ctx).requestSecret({
        credential_id: p.credentialId,
        raw: p.raw,
        purpose: p.purpose,
      })
      return fromEnvelope(env)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_get_request ---

const GetRequestInput = z.object({
  requestId: z.string().describe('The request_id returned by a prior Paybox request tool'),
})

export const payboxGetRequest: Tool = {
  name: 'paybox_get_request',
  description:
    'Poll a previously-issued Paybox request until it reaches a terminal status ' +
    '(success / denied / error). This is how pending_approval and pending_signature ' +
    'operations finish. Polling is idempotent — never re-call the original request tool.',
  inputSchema: {
    type: 'object',
    properties: {
      requestId: { type: 'string', description: 'request_id from a prior Paybox request' },
    },
    required: ['requestId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('checking a Paybox request')
    try {
      const p = GetRequestInput.parse(input)
      const env = await getClient(ctx).getRequest(p.requestId)
      return fromEnvelope(env)
    } catch (err) {
      return toError(err)
    }
  },
}
