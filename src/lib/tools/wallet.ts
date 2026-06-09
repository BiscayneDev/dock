import { z } from 'zod'
import { getOWSClient } from '@/lib/integrations/openwallet'
import { isPayboxConnected, payboxRequired } from '@/lib/integrations/paybox'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

function getClient(ctx: UserContext): ReturnType<typeof getOWSClient> {
  const tokens = ctx.tokens.openwallet
  if (!tokens) {
    throw new Error('OpenWallet not connected. Connect it in The Harbor settings.')
  }
  return getOWSClient(tokens)
}

// --- wallet_list ---

export const walletList: Tool = {
  name: 'wallet_list',
  description: 'List all wallets in the connected OpenWallet vault.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const ows = getClient(ctx)
      const res = await ows.listWallets()

      if (!res.ok) {
        return { success: false, error: res.error ?? 'Failed to list wallets' }
      }

      return { success: true, data: res.data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- wallet_accounts ---

const AccountsInput = z.object({
  walletId: z.string().describe('Wallet ID to list accounts for'),
})

export const walletAccounts: Tool = {
  name: 'wallet_accounts',
  description: 'List all chain-specific accounts (addresses) for a wallet.',
  inputSchema: {
    type: 'object',
    properties: {
      walletId: { type: 'string', description: 'Wallet ID' },
    },
    required: ['walletId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = AccountsInput.parse(input)
      const ows = getClient(ctx)
      const res = await ows.listAccounts(parsed.walletId)

      if (!res.ok) {
        return { success: false, error: res.error ?? 'Failed to list accounts' }
      }

      return { success: true, data: res.data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- wallet_balance ---

const BalanceInput = z.object({
  accountId: z.string().describe('Account ID (CAIP-10 format)'),
  chainId: z.string().describe('Chain ID (CAIP-2 format, e.g. "eip155:1" for Ethereum mainnet)'),
})

export const walletBalance: Tool = {
  name: 'wallet_balance',
  description: 'Get the balance for a specific account on a blockchain.',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'Account ID (CAIP-10)' },
      chainId: { type: 'string', description: 'Chain ID (CAIP-2, e.g. "eip155:1")' },
    },
    required: ['accountId', 'chainId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = BalanceInput.parse(input)
      const ows = getClient(ctx)
      const res = await ows.getBalance(parsed.accountId, parsed.chainId)

      if (!res.ok) {
        return { success: false, error: res.error ?? 'Failed to get balance' }
      }

      return { success: true, data: res.data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- wallet_send ---

const SendInput = z.object({
  walletId: z.string().describe('Wallet ID to send from'),
  chainId: z.string().describe('Chain ID (CAIP-2 format)'),
  to: z.string().describe('Recipient address'),
  amount: z.string().describe('Amount to send (in native units, e.g. "0.1" for 0.1 ETH)'),
  token: z.string().optional().describe('Token contract address (omit for native currency)'),
})

export const walletSend: Tool = {
  name: 'wallet_send',
  description: 'Send cryptocurrency to an address. REQUIRES user confirmation before execution. Supports native tokens and ERC-20/SPL tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      walletId: { type: 'string', description: 'Wallet ID to send from' },
      chainId: { type: 'string', description: 'Chain ID (CAIP-2)' },
      to: { type: 'string', description: 'Recipient address' },
      amount: { type: 'string', description: 'Amount in native units (e.g. "0.1")' },
      token: { type: 'string', description: 'Token contract address (omit for native)' },
    },
    required: ['walletId', 'chainId', 'to', 'amount'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    // Money movement is gated on Paybox. If connected, the existing OpenWallet
    // rail executes the send as a fallback (Paybox MPC signing lands in Phase 2).
    if (!isPayboxConnected(ctx)) return payboxRequired('sending crypto')
    try {
      const parsed = SendInput.parse(input)
      const ows = getClient(ctx)

      const transaction: Record<string, unknown> = {
        to: parsed.to,
        value: parsed.amount,
      }

      if (parsed.token) {
        transaction.token = parsed.token
      }

      // Simulate first to catch errors before signing
      const simResult = await ows.simulate(parsed.walletId, parsed.chainId, transaction)
      if (!simResult.ok) {
        return {
          success: false,
          error: `Transaction simulation failed: ${simResult.error ?? 'Unknown error'}. Transaction was NOT sent.`,
        }
      }

      // Sign and send
      const res = await ows.signAndSend(parsed.walletId, parsed.chainId, transaction)

      if (!res.ok) {
        return { success: false, error: res.error ?? 'Failed to send transaction' }
      }

      return {
        success: true,
        data: {
          ...(res.data as Record<string, unknown>),
          simulation: simResult.data,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- wallet_sign_message ---

const SignMessageInput = z.object({
  walletId: z.string().describe('Wallet ID'),
  chainId: z.string().describe('Chain ID (CAIP-2 format)'),
  message: z.string().describe('Message to sign'),
})

export const walletSignMessage: Tool = {
  name: 'wallet_sign_message',
  description: 'Sign an arbitrary message with a wallet. Returns the signature.',
  inputSchema: {
    type: 'object',
    properties: {
      walletId: { type: 'string', description: 'Wallet ID' },
      chainId: { type: 'string', description: 'Chain ID (CAIP-2)' },
      message: { type: 'string', description: 'Message to sign' },
    },
    required: ['walletId', 'chainId', 'message'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SignMessageInput.parse(input)
      const ows = getClient(ctx)
      const res = await ows.signMessage(parsed.walletId, parsed.chainId, parsed.message)

      if (!res.ok) {
        return { success: false, error: res.error ?? 'Failed to sign message' }
      }

      return { success: true, data: res.data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- wallet_simulate ---

const SimulateInput = z.object({
  walletId: z.string().describe('Wallet ID'),
  chainId: z.string().describe('Chain ID (CAIP-2 format)'),
  to: z.string().describe('Recipient address'),
  amount: z.string().describe('Amount in native units'),
  token: z.string().optional().describe('Token contract address'),
})

export const walletSimulate: Tool = {
  name: 'wallet_simulate',
  description: 'Simulate a transaction without sending it. Use this to preview gas costs and check for errors before sending.',
  inputSchema: {
    type: 'object',
    properties: {
      walletId: { type: 'string', description: 'Wallet ID' },
      chainId: { type: 'string', description: 'Chain ID (CAIP-2)' },
      to: { type: 'string', description: 'Recipient address' },
      amount: { type: 'string', description: 'Amount in native units' },
      token: { type: 'string', description: 'Token contract address' },
    },
    required: ['walletId', 'chainId', 'to', 'amount'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SimulateInput.parse(input)
      const ows = getClient(ctx)

      const transaction: Record<string, unknown> = {
        to: parsed.to,
        value: parsed.amount,
      }
      if (parsed.token) {
        transaction.token = parsed.token
      }

      const res = await ows.simulate(parsed.walletId, parsed.chainId, transaction)

      if (!res.ok) {
        return { success: false, error: res.error ?? 'Simulation failed' }
      }

      return { success: true, data: res.data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- wallet_info ---

const InfoInput = z.object({
  walletId: z.string().describe('Wallet ID to get details for'),
})

export const walletInfo: Tool = {
  name: 'wallet_info',
  description: 'Get detailed information about a specific wallet, including supported chains and policies.',
  inputSchema: {
    type: 'object',
    properties: {
      walletId: { type: 'string', description: 'Wallet ID' },
    },
    required: ['walletId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = InfoInput.parse(input)
      const ows = getClient(ctx)
      const res = await ows.getWallet(parsed.walletId)

      if (!res.ok) {
        return { success: false, error: res.error ?? 'Failed to get wallet info' }
      }

      return { success: true, data: res.data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}
