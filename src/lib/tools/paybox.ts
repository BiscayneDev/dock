import { z } from 'zod'
import {
  getPayboxSdk,
  isPayboxConnected,
  payboxRequired,
  agentResultToTool,
} from '@/lib/integrations/paybox'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

// Paybox — passkey-gated payments, secrets, and non-custodial wallet ops, driven
// through the official @paybox-sh/sdk over the user's OAuth token. Wallet sign /
// swap complete in-process when the user has provisioned a `pbxk1.` signing key
// (otherwise they return pending_signature). See integrations/paybox.ts.

type Sdk = Awaited<ReturnType<typeof getPayboxSdk>>

async function sdkFor(ctx: UserContext): Promise<Sdk> {
  return getPayboxSdk(ctx.tokens.paybox, ctx.userId)
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
      const creds = await (await sdkFor(ctx)).listCredentials()
      return { success: true, data: creds }
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_request_payment ---

const PaymentInput = z.object({
  credentialId: z.string().describe('A card-kind credential id from paybox_list_credentials'),
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
      credentialId: { type: 'string', description: 'Card credential id' },
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
      const resp = await (await sdkFor(ctx)).requestPayment({
        credentialId: p.credentialId,
        merchant: p.merchant,
        merchantUrl: p.merchantUrl,
        amountCents: p.amountCents,
        currency: p.currency,
      })
      return agentResultToTool(resp)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_request_secret ---

const SecretInput = z.object({
  credentialId: z.string().describe('A secret-kind credential id from paybox_list_credentials'),
  raw: z
    .boolean()
    .default(false)
    .describe('false (default) returns a one-time secret token; true returns plaintext if the grant allows'),
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
      credentialId: { type: 'string', description: 'Secret credential id' },
      raw: { type: 'boolean', description: 'false = one-time token (preferred); true = plaintext' },
      purpose: { type: 'string', description: 'Why the secret is needed' },
    },
    required: ['credentialId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('using a stored secret')
    try {
      const p = SecretInput.parse(input)
      const resp = await (await sdkFor(ctx)).requestSecret({
        credentialId: p.credentialId,
        raw: p.raw,
        purpose: p.purpose,
      })
      return agentResultToTool(resp)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_request_wallet_sign ---

const WalletSignInput = z.object({
  credentialId: z.string().describe('A wallet-kind credential id from paybox_list_credentials'),
  intent: z
    .record(z.string(), z.unknown())
    .describe(
      'What to sign, tagged by op: ' +
        '{"op":"message","message":"..."} (EIP-191), ' +
        '{"op":"typedData","typedData":{...}} (EIP-712), ' +
        '{"op":"transaction","transaction":{...eip1559...}}, ' +
        '{"op":"solanaMessage","address":"<base58>","message":"..."}, ' +
        '{"op":"solanaTransaction","address":"<base58>","transactionBase64":"..."}. ' +
        'The chain/destination/value are read from the intent — do NOT pre-hash.'
    ),
})

export const payboxRequestWalletSign: Tool = {
  name: 'paybox_request_wallet_sign',
  description:
    'Sign with a Paybox wallet credential (message, typed data, or a transaction). ' +
    'Signing is non-custodial and runs in-process via the user\'s signing key — the ' +
    'private key never leaves MoonX MPC. Completes immediately on an autonomous grant; ' +
    'otherwise returns pending_approval (user approves with a passkey) — then poll ' +
    'paybox_get_request. On success, output holds the signature or serialized transaction.',
  inputSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'Wallet credential id' },
      intent: {
        type: 'object',
        description: 'What to sign, tagged by an "op" field (message/typedData/transaction/solana*)',
      },
    },
    required: ['credentialId', 'intent'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('signing with a wallet')
    try {
      const p = WalletSignInput.parse(input)
      const sdk = await sdkFor(ctx)
      const resp = await sdk.requestWalletSign({
        credentialId: p.credentialId,
        intent: p.intent as Parameters<typeof sdk.requestWalletSign>[0]['intent'],
      })
      return agentResultToTool(resp)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_request_swap ---

const SwapInput = z.object({
  credentialId: z.string().describe('A wallet-kind credential id'),
  srcChain: z.string().describe('CAIP-2 source chain, e.g. "eip155:8453" (EVM) or "solana:..."'),
  dstChain: z.string().optional().describe('Defaults to srcChain (same-chain only for now)'),
  srcToken: z.string().describe('Source token address, or "native" for the chain native asset'),
  dstToken: z.string().describe('Destination token address'),
  amount: z.string().describe("Amount in the source token's smallest unit, as a decimal string"),
  slippageBps: z.number().int().optional().describe('Slippage in bps (default 50 = 0.5%)'),
  valueCents: z.number().int().optional().describe('Rough USD value of the sell side, for policy'),
})

export const payboxRequestSwap: Tool = {
  name: 'paybox_request_swap',
  description:
    'Swap one token for another from a Paybox wallet credential. Paybox quotes the route, ' +
    'builds the transactions, signs in-process, and broadcasts. Completes on an autonomous ' +
    'grant; otherwise pending_approval (poll paybox_get_request). Call paybox_get_portfolio ' +
    'first to size the amount. On success, output holds the swap transaction hash.',
  inputSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'Wallet credential id' },
      srcChain: { type: 'string', description: 'CAIP-2 source chain (e.g. eip155:8453)' },
      dstChain: { type: 'string', description: 'Destination chain (defaults to srcChain)' },
      srcToken: { type: 'string', description: 'Source token address or "native"' },
      dstToken: { type: 'string', description: 'Destination token address' },
      amount: { type: 'string', description: "Amount in source token's smallest unit (decimal string)" },
      slippageBps: { type: 'integer', description: 'Slippage in bps (default 50)' },
      valueCents: { type: 'integer', description: 'Rough USD value of the sell side' },
    },
    required: ['credentialId', 'srcChain', 'srcToken', 'dstToken', 'amount'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('swapping tokens')
    try {
      const p = SwapInput.parse(input)
      const result = await (await sdkFor(ctx)).requestSwap({
        credentialId: p.credentialId,
        srcChain: p.srcChain,
        dstChain: p.dstChain,
        srcToken: p.srcToken,
        dstToken: p.dstToken,
        amount: p.amount,
        slippageBps: p.slippageBps,
        valueCents: p.valueCents,
      })
      return agentResultToTool(result.response)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_get_portfolio ---

const PortfolioInput = z.object({
  address: z.string().describe('Wallet address (EVM 0x… or Solana base58)'),
  networkIds: z.string().optional().describe('Comma-separated network ids, e.g. "1,8453"; omit to auto-detect'),
})

export const payboxGetPortfolio: Tool = {
  name: 'paybox_get_portfolio',
  description:
    "List a Paybox wallet's token balances across chains (public on-chain data). " +
    'Use before paybox_request_swap to pick the token and size the amount.',
  inputSchema: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'Wallet address (EVM or Solana)' },
      networkIds: { type: 'string', description: 'Comma-separated network ids (e.g. "1,8453")' },
    },
    required: ['address'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('reading a wallet portfolio')
    try {
      const p = PortfolioInput.parse(input)
      const data = await (await sdkFor(ctx)).getPortfolio({
        address: p.address,
        networkIds: p.networkIds,
      })
      return { success: true, data }
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_discover_services ---

const DiscoverInput = z.object({
  query: z.string().optional().describe('Optional ranked search term; omit for the full catalog'),
})

export const payboxDiscoverServices: Tool = {
  name: 'paybox_discover_services',
  description:
    'Browse paid x402 services from the Paybox/MoonPay Bazaar catalog. Returns each ' +
    "service's resource URL, description, and accepts (payment requirements). Pair with " +
    'paybox_use_service (Paybox pays + fetches) or paybox_pay_x402 (get an X-PAYMENT header).',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Optional search term' } },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('browsing paid services')
    try {
      const p = DiscoverInput.parse(input)
      const services = await (await sdkFor(ctx)).discoverServices(p.query)
      return { success: true, data: services }
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_use_service ---

const UseServiceInput = z.object({
  credentialId: z.string().describe('A wallet-kind credential id to pay from'),
  url: z.string().describe('The paid x402 resource URL to fetch'),
  method: z.string().optional().describe('HTTP method (default GET)'),
  body: z.unknown().optional().describe('Optional JSON request body (for POST/PUT)'),
})

export const payboxUseService: Tool = {
  name: 'paybox_use_service',
  description:
    'Fetch a paid x402 resource and have Paybox pay for it (gateway mode): Paybox probes ' +
    'the url, pays the 402 from a wallet credential, re-fetches, and returns the resource ' +
    "reply. On success, output.response holds the resource's reply. May require approval.",
  inputSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'Wallet credential id to pay from' },
      url: { type: 'string', description: 'Paid x402 resource URL' },
      method: { type: 'string', description: 'HTTP method (default GET)' },
      body: { type: 'object', description: 'Optional JSON request body' },
    },
    required: ['credentialId', 'url'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('using a paid service')
    try {
      const p = UseServiceInput.parse(input)
      const result = await (await sdkFor(ctx)).useService({
        credentialId: p.credentialId,
        url: p.url,
        method: p.method,
        body: p.body,
      })
      return agentResultToTool(result.response)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_pay_x402 ---

const PayX402Input = z.object({
  credentialId: z.string().describe('A wallet-kind credential id to pay from'),
  resourceUrl: z.string().describe('The paywalled resource URL'),
  accepts: z
    .array(z.unknown())
    .describe("The 402's `accepts` PaymentRequirements array, verbatim (from the resource's 402 or paybox_discover_services)"),
})

export const payboxPayX402: Tool = {
  name: 'paybox_pay_x402',
  description:
    'Pay a paid x402 endpoint from a wallet credential (header mode). On success, ' +
    'output.x_payment is the X-PAYMENT header to replay on the original request. Use ' +
    'paybox_use_service instead if you want Paybox to make the paid call for you.',
  inputSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'Wallet credential id to pay from' },
      resourceUrl: { type: 'string', description: 'Paywalled resource URL' },
      accepts: { type: 'array', description: "The 402's accepts PaymentRequirements array" },
    },
    required: ['credentialId', 'resourceUrl', 'accepts'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('paying for an x402 resource')
    try {
      const p = PayX402Input.parse(input)
      const result = await (await sdkFor(ctx)).payX402({
        credentialId: p.credentialId,
        resourceUrl: p.resourceUrl,
        accepts: p.accepts,
      })
      return agentResultToTool(result.response)
    } catch (err) {
      return toError(err)
    }
  },
}

// --- paybox_get_request ---
const GetRequestInput = z.object({
  requestId: z.string().describe('The request id returned by a prior Paybox request tool'),
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
      requestId: { type: 'string', description: 'request id from a prior Paybox request' },
    },
    required: ['requestId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('checking a Paybox request')
    try {
      const p = GetRequestInput.parse(input)
      const resp = await (await sdkFor(ctx)).getRequest(p.requestId)
      return agentResultToTool(resp)
    } catch (err) {
      return toError(err)
    }
  },
}
