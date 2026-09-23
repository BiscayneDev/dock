import { z } from 'zod'
import {
  getPayboxSdk,
  isPayboxConnected,
  payboxRequired,
  agentResultToTool,
} from '@/lib/integrations/paybox'
import { assertWithinCap, recordSpend } from '@/lib/payments/spend-caps'
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
      await assertWithinCap(ctx.userId, p.amountCents / 100)
      const resp = await (await sdkFor(ctx)).requestPayment({
        credentialId: p.credentialId,
        merchant: p.merchant,
        merchantUrl: p.merchantUrl,
        amountCents: p.amountCents,
        currency: p.currency,
      })
      const result = agentResultToTool(resp)
      if (result.success) {
        // Card issued and charged amount is fixed — record it in the shared
        // ledger. A ledger-write failure fails closed: surface the error even
        // though the request went through, so the miss is never silent.
        try {
          await recordSpend(
            ctx.userId,
            'paybox_payment',
            p.amountCents / 100,
            `paybox payment to ${p.merchant} (${p.merchantUrl})`
          )
        } catch (err) {
          return {
            success: false,
            error:
              `Payment request succeeded but failed to record spend in ledger: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }
      return result
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
      await assertWithinCap(ctx.userId, (p.valueCents ?? 0) / 100)
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
      const toolResult = agentResultToTool(result.response)
      if (toolResult.success) {
        // Swap settled (broadcast). Record the sell-side USD estimate — a
        // ledger-write failure fails closed and is surfaced, never swallowed.
        try {
          await recordSpend(
            ctx.userId,
            'paybox_swap',
            (p.valueCents ?? 0) / 100,
            `paybox swap ${p.srcToken} -> ${p.dstToken} on ${p.srcChain}, amount ${p.amount}`
          )
        } catch (err) {
          return {
            success: false,
            error:
              `Swap succeeded but failed to record spend in ledger: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }
      return toolResult
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

// --- paybox_onramp ---

const OnrampInput = z.object({
  credentialId: z.string().describe('A Paybox credential id from paybox_list_credentials'),
  amountUsd: z.number().positive().describe('How much USD of crypto to buy (e.g. 25)'),
  destinationChain: z
    .enum(['solana:mainnet', 'eip155:8453', 'eip155:1', 'eip155:4663'])
    .default('solana:mainnet')
    .describe('Chain to fund — Solana mainnet by default (x402 settlement + inference rail)'),
  currencyCode: z.string().default('USDC').describe('Token to buy (USDC default)'),
})

export const payboxOnramp: Tool = {
  name: 'paybox_onramp',
  description:
    'Get a hosted buy link (Paybox on-ramp, MoonPay-powered) so the user can top up their ' +
    'wallet with card — for x402 usage and inference spend. Sends a link the user completes ' +
    'in Paybox with their passkey; nothing is charged by this tool.',
  inputSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', description: 'Paybox credential id (paybox_list_credentials)' },
      amountUsd: { type: 'number', description: 'USD amount to buy (e.g. 25)' },
      destinationChain: { type: 'string', enum: ['solana:mainnet', 'eip155:8453', 'eip155:1', 'eip155:4663'], description: 'Chain to fund (default solana:mainnet)' },
      currencyCode: { type: 'string', description: 'Token to buy (default USDC)' },
    },
    required: ['credentialId', 'amountUsd'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('topping up a wallet')
    try {
      const p = OnrampInput.parse(input)
      const sdk = await sdkFor(ctx)
      const buy = await sdk.getBuyLink({
        credentialId: p.credentialId,
        destinationChain: p.destinationChain,
        currencyCode: p.currencyCode,
        amountUsd: p.amountUsd,
      })
      return {
        success: true,
        data: {
          buyUrl: buy.url,
          currency: buy.currency_code,
          walletAddress: buy.wallet_address,
          network: buy.network,
          note: 'user completes the purchase in Paybox with their passkey — funds land directly in their wallet',
        },
      }
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
