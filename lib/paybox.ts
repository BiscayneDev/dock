/**
 * Paybox — the OS's non-custodial wallet for x402 payments.
 *
 * Paybox (paybox.sh) vaults the user's wallet behind passkey-gated grants; the
 * private key never reaches this app. We use the Paybox SDK to list credentials
 * and to sign settlement transactions *within the user's grant*, and
 * shipyard-inference's payment layer (payboxSigner + createSolanaPayProvider +
 * createPayingFetch) to settle x402 challenges transparently: call an endpoint,
 * on 402 sign the USDC transfer via Paybox, retry, return the paid result.
 *
 * Configuration (all optional — absent means "not connected"):
 *   PAYBOX_API_KEY      pbx_live_* personal API key (Vercel) — locally, the
 *                       SDK also reads ~/.config/paybox/config.json from
 *                       `paybox login`.
 *   PAYBOX_SIGNING_KEY  pbxk1.* signing key for in-process wallet signing.
 *   PAYBOX_BASE_URL     API origin override (default https://api.paybox.sh).
 *   PAYBOX_NETWORK      mainnet | devnet (default mainnet).
 *   PAYBOX_WALLET_ID    credentialId of the wallet to pay from; also selectable
 *                       from the treasury UI (stored in protected local storage or KV).
 *   PAYBOX_MAX_PAYMENT_USDC  per-request spend cap, whole USDC (default 1).
 */

import { privateStorePath, readPrivateStore, writePrivateStore } from "./private-store"
import { existsSync } from "fs"
import { homedir } from "os"
import path from "path"
import type { PayboxClient } from "@paybox-sh/sdk"
import { createPayingFetch } from "shipyard-inference"
import type { PaymentProvider, PaymentRequirement, PaymentResult } from "shipyard-inference"
import { refreshOauth, type PayboxOauth } from "./paybox-connect"

export type { PayboxOauth } from "./paybox-connect"

/** Minimal signer shape `createSolanaPayProvider` accepts. */
interface SolanaSignerShape {
  publicKey: string
  signTransaction(tx: Uint8Array): Promise<Uint8Array>
  signMessage?(message: Uint8Array): Promise<Uint8Array>
}

// ── Client ───────────────────────────────────────────────────────────────────

/** OAuth token shape carried by PAYBOX_OAUTH env (same as the connect store). */
type StoredOauth = PayboxOauth

/** Parsed PAYBOX_OAUTH env (full OAuth JSON for serverless deployments). */
function envOauth(): StoredOauth | null {
  const raw = process.env.PAYBOX_OAUTH?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredOauth
    return parsed.accessToken ? parsed : null
  } catch {
    return null
  }
}

export function payboxEnvConfigured(): boolean {
  if (process.env.PAYBOX_API_KEY || process.env.PAYBOX_SIGNING_KEY || envOauth()) {
    return true
  }
  // Local `paybox login` writes ~/.config/paybox/config.json (oauth + signing
  // key) — that's a live connection too, not just env-var configuration.
  try {
    return existsSync(path.join(homedir(), ".config", "paybox", "config.json"))
  } catch {
    return false
  }
}

/**
 * A Paybox client. Locally `PayboxClient.fromConfig()` also reads
 * ~/.config/paybox/config.json (written by `paybox login`); env vars are passed
 * as explicit overrides so Vercel deployments work with no filesystem.
 *
 * Serverless auth (Vercel): set PAYBOX_OAUTH to the full OAuth JSON from the
 * local config's `oauth` field plus PAYBOX_SIGNING_KEY. The access token is
 * short-lived, so it is refreshed via the SDK's refreshTokens when within
 * 5 minutes of expiry. Refresh-token rotation can't be persisted back to env
 * vars — for a durable deployment prefer a `pbx_live_` API key (PAYBOX_API_KEY).
 * Returns null when nothing is configured.
 */
export async function payboxClient(): Promise<PayboxClient | null> {
  try {
    const { PayboxClient } = await import("@paybox-sh/sdk")
    const baseUrl = process.env.PAYBOX_BASE_URL ?? "https://api.paybox.sh"

    // In-app Connect flow first (rotation persists via the store), then the
    // PAYBOX_OAUTH env var, then the local `paybox login` config file.
    const storedOauth = await getStoredOauth()
    const oauth = storedOauth ?? envOauth()
    if (oauth) {
      let tokens = oauth
      const expiringSoon =
        tokens.expiresAt !== undefined && tokens.expiresAt - Date.now() < 5 * 60_000
      if (tokens.refreshToken && expiringSoon) {
        try {
          tokens = await refreshOauth(tokens)
          if (storedOauth) await saveConnectedOauth(tokens) // persist rotation
        } catch {
          // Refresh failed (revoked?) — try the stored token; a dead token
          // surfaces as a 401 on the request itself.
        }
      }
      const signingKey = (await getSigningKey()) ?? process.env.PAYBOX_SIGNING_KEY
      return new PayboxClient({
        baseUrl,
        token: tokens.accessToken,
        ...(signingKey ? { signingKey } : {}),
      })
    }

    return PayboxClient.fromConfig({
      ...(process.env.PAYBOX_BASE_URL ? { baseUrl: process.env.PAYBOX_BASE_URL } : {}),
      ...(process.env.PAYBOX_API_KEY ? { apiKey: process.env.PAYBOX_API_KEY } : {}),
      ...(process.env.PAYBOX_SIGNING_KEY ? { signingKey: process.env.PAYBOX_SIGNING_KEY } : {}),
    })
  } catch {
    return null
  }
}

export function payboxNetwork(): "mainnet" | "devnet" {
  return process.env.PAYBOX_NETWORK === "devnet" ? "devnet" : "mainnet"
}

// ── Wallet selection + history (protected local storage, KV, or memory on Vercel) ──────────

interface PayboxPaymentRecord {
  at: number
  url: string
  amountAtomic: string
  network: string
  reference?: string
}

interface PayboxStore {
  walletCredentialId?: string
  payments?: PayboxPaymentRecord[]
  /** OAuth tokens from the in-app Connect Paybox flow. */
  oauth?: PayboxOauth
  /** Signing key pasted/connected in-app (`pbxk1.…`). */
  signingKey?: string
}

// Old worktree state is deliberately not imported: reconnect locally once.
// Existing KV, environment, and SDK-managed connections are unchanged.
const MAX_HISTORY = 100

let memoryStore: PayboxStore | null = null

function useMemoryStore(): boolean {
  return (
    (Boolean(process.env.VERCEL) || Boolean(process.env.VERCEL_ENV)) &&
    !process.env.KV_REST_API_URL
  )
}

async function readStore(): Promise<PayboxStore> {
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import("@vercel/kv")
    // Fail closed on KV errors. Do not copy credentials to a fallback backend.
    return (await kv.get<PayboxStore>("paybox")) ?? {}
  }
  if (useMemoryStore()) return memoryStore ?? {}
  return (await readPrivateStore(await privateStorePath()) as PayboxStore | null) ?? {}
}

async function writeStore(store: PayboxStore): Promise<void> {
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import("@vercel/kv")
    await kv.set("paybox", store)
    return
  }
  if (useMemoryStore()) {
    memoryStore = store
    return
  }
  await writePrivateStore(await privateStorePath(), store)
}

// ── In-app connection store helpers ─────────────────────────────────────────

/** OAuth tokens from the in-app Connect flow (null when not connected that way). */
export async function getStoredOauth(): Promise<PayboxOauth | null> {
  const store = await readStore()
  return store.oauth ?? null
}

/** Persist tokens from a completed Connect flow (rotation-aware). */
export async function saveConnectedOauth(oauth: PayboxOauth): Promise<void> {
  const store = await readStore()
  store.oauth = oauth
  await writeStore(store)
}

/** Disconnect: forget in-app tokens + signing key (env-based config remains). */
export async function clearConnection(): Promise<void> {
  const store = await readStore()
  delete store.oauth
  delete store.signingKey
  await writeStore(store)
}

/** The connected signing key, if the user provided one in-app. */
export async function getSigningKey(): Promise<string | null> {
  const store = await readStore()
  return store.signingKey ?? null
}

/** Save a signing key from the UI (`pbxk1.…`). */
export async function setSigningKey(key: string): Promise<void> {
  const store = await readStore()
  store.signingKey = key
  await writeStore(store)
}

/** Whether the user connected via the in-app flow (vs env / local config). */
export async function hasInAppConnection(): Promise<boolean> {
  const store = await readStore()
  return Boolean(store.oauth)
}

export async function selectedWalletCredentialId(): Promise<string | null> {
  if (process.env.PAYBOX_WALLET_ID) return process.env.PAYBOX_WALLET_ID
  const store = await readStore()
  return store.walletCredentialId ?? null
}

async function recordPayment(record: PayboxPaymentRecord): Promise<void> {
  const store = await readStore()
  store.payments = [record, ...(store.payments ?? [])].slice(0, MAX_HISTORY)
  await writeStore(store)
}

export async function listPaymentHistory(): Promise<PayboxPaymentRecord[]> {
  const store = await readStore()
  return store.payments ?? []
}

// ── Credential listing ────────────────────────────────────────────────────────

export interface PayboxCredential {
  id: string
  label?: string
  kind?: string
  address?: string
}

/** List usable credentials from the connected Paybox vault. */
export async function listPayboxCredentials(): Promise<PayboxCredential[]> {
  const client = await payboxClient()
  if (!client) return []
  try {
    const result = (await client.listCredentials()) as {
      credentials?: Array<{
        credential?: {
          id?: string
          name?: string
          credential_type?: string
          metadata?: { address?: string }
        }
      }>
    }
    return (result.credentials ?? [])
      .filter((g) => g.credential?.id)
      .map((g) => {
        const c = g.credential!
        return {
          id: c.id ?? "",
          label: c.name,
          kind: c.credential_type,
          address: c.metadata?.address,
        }
      })
  } catch {
    return []
  }
}

// ── Wallet signer (versioned→legacy conversion) ─────────────────────────────
//
// shipyard-inference's settle path builds a *versioned* transaction, but the
// Paybox SDK's in-process `solanaTransaction` signing (`MoonXSolanaSigner`)
// parses with the *legacy* `Transaction.from()` — feeding it versioned bytes
// throws "Versioned messages must be deserialized with
// VersionedMessage.deserialize()". We therefore convert versioned → legacy
// before handing bytes to Paybox; the returned signed legacy tx is equally
// valid on-chain, and the gateway submits whatever bytes we return.

async function versionedToLegacy(bytes: Uint8Array): Promise<Uint8Array> {
  const web3 = await import("@solana/web3.js")
  type Pubkey = InstanceType<typeof web3.PublicKey>
  const vtx = web3.VersionedTransaction.deserialize(bytes)
  const msg = vtx.message as unknown as {
    staticAccountKeys?: Pubkey[]
    accountKeys?: Pubkey[]
    recentBlockhash: string
    compiledInstructions: Array<{ programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array }>
    isAccountSigner(i: number): boolean
    isAccountWritable(i: number): boolean
  }
  // Address-lookup tables are never used by our settle path — refuse loudly.
  if (!msg.compiledInstructions || (!msg.staticAccountKeys && !msg.accountKeys)) {
    throw new Error("paybox signer: unsupported transaction shape (address lookup tables?)")
  }
  const keys = msg.staticAccountKeys ?? msg.accountKeys!
  const legacy = new web3.Transaction()
  legacy.feePayer = keys[0]
  legacy.recentBlockhash = msg.recentBlockhash
  for (const ci of msg.compiledInstructions) {
    legacy.add(
      new web3.TransactionInstruction({
        programId: keys[ci.programIdIndex],
        keys: ci.accountKeyIndexes.map((i) => ({
          pubkey: keys[i],
          isSigner: msg.isAccountSigner(i),
          isWritable: msg.isAccountWritable(i),
        })),
        data: Buffer.from(ci.data),
      }),
    )
  }
  return legacy.serialize({ requireAllSignatures: false, verifySignatures: false })
}

/** Poll a pending Paybox request until it leaves a pending state. */
async function waitForPaybox(
  client: PayboxClient,
  requestId: string,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  let response = await client.getRequest(requestId)
  while (
    (response.status === "pending_approval" || response.status === "pending_signature") &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 2_000))
    response = await client.getRequest(requestId)
  }
  if (response.status !== "success") {
    throw new Error(
      `Paybox request ${requestId} ended '${String(response.status)}'` +
        (typeof (response as { error?: string }).error === "string"
          ? `: ${(response as { error: string }).error}`
          : ""),
    )
  }
  return response as unknown as Record<string, unknown>
}

/**
 * A non-custodial Solana signer backed by a Paybox wallet credential, with the
 * versioned→legacy conversion above. Signs inside the user's Paybox grant —
 * the private key never reaches this process.
 */
function payboxWalletSigner(options: {
  client: PayboxClient
  credentialId: string
  address: string
  network: "mainnet" | "devnet"
}): SolanaSignerShape {
  const chain = options.network === "devnet" ? "solana:devnet" : "solana:mainnet-beta"
  return {
    publicKey: options.address,
    async signTransaction(tx: Uint8Array): Promise<Uint8Array> {
      const legacyBase64 = Buffer.from(await versionedToLegacy(tx)).toString("base64")
      const first = await options.client.requestWalletSign({
        credentialId: options.credentialId,
        chain,
        intent: {
          op: "solanaTransaction",
          address: options.address,
          transactionBase64: legacyBase64,
        },
      } as Parameters<PayboxClient["requestWalletSign"]>[0])
      const response =
        first.status === "pending_approval" || first.status === "pending_signature"
          ? await waitForPaybox(options.client, first.request_id)
          : (first as unknown as Record<string, unknown>)
      const out = (response as { output?: { value?: unknown } }).output?.value
      const signed =
        typeof out === "string"
          ? out
          : out &&
              typeof out === "object" &&
              typeof (out as { signedTransactionBase64?: unknown }).signedTransactionBase64 === "string"
            ? (out as { signedTransactionBase64: string }).signedTransactionBase64
            : undefined
      if (typeof signed !== "string") {
        throw new Error("Paybox wallet sign returned no signed transaction")
      }
      return new Uint8Array(Buffer.from(signed, "base64"))
    },
  }
}

// ── Vendored Solana settle provider (fresh-payee safe) ──────────────────────
//
// shipyard-inference@0.20.0's createSolanaPayProvider builds a bare transfer,
// which fails on-chain with InvalidAccountData when the payee's USDC token
// account doesn't exist (any brand-new treasury). This local provider mirrors
// the fixed upstream settle (commit 7313317): it leads with an idempotent
// create-ATA instruction — a no-op when the destination exists, otherwise the
// sender pays the ~0.002 SOL rent, exactly like wallet apps do. Swap back to
// createSolanaPayProvider once shipyard-inference >=0.20.1 is published.

const USDC_MINT = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const

const DEFAULT_RPC = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
} as const

function payboxSolanaPayProvider(options: {
  signer: SolanaSignerShape
  network: "mainnet" | "devnet"
}): PaymentProvider {
  const network = options.network
  const settled = new Map<string, PaymentResult>()
  const inflight = new Map<string, Promise<PaymentResult>>()

  function idempotencyKey(req: PaymentRequirement): string {
    if (req.nonce) return req.nonce
    return `${req.resource}|${req.amount}|${req.payTo}`
  }

  async function settle(requirement: PaymentRequirement): Promise<PaymentResult> {
    const web3 = await import("@solana/web3.js")
    const splToken = await import("@solana/spl-token")
    const rpc = DEFAULT_RPC[network]
    const connection = new web3.Connection(rpc, "confirmed")
    const mint = new web3.PublicKey(USDC_MINT[network])
    const payer = new web3.PublicKey(options.signer.publicKey)
    const recipient = new web3.PublicKey(requirement.payTo)

    const payerAta = await splToken.getAssociatedTokenAddress(mint, payer)
    const recipientAta = await splToken.getAssociatedTokenAddress(mint, recipient)

    const instructions = [
      // Fresh-payee fix: create the destination token account if missing.
      splToken.createAssociatedTokenAccountIdempotentInstruction(
        payer,
        recipientAta,
        recipient,
        mint,
      ),
      splToken.createTransferInstruction(
        payerAta,
        recipientAta,
        payer,
        BigInt(requirement.amount),
      ),
    ]

    const { blockhash } = await connection.getLatestBlockhash()
    const message = new web3.TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message()
    const tx = new web3.VersionedTransaction(message)
    const signed = await options.signer.signTransaction(tx.serialize())

    const header = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: requirement.scheme ?? "exact",
        network: `solana-${network}`,
        payload: { transaction: Buffer.from(signed).toString("base64") },
      }),
    ).toString("base64")

    return { header, reference: idempotencyKey(requirement), amount: requirement.amount }
  }

  return {
    async pay(requirement: PaymentRequirement): Promise<PaymentResult> {
      const key = idempotencyKey(requirement)
      const done = settled.get(key)
      if (done) return done
      const pending = inflight.get(key)
      if (pending) return pending
      const promise = settle(requirement)
        .then((result) => {
          settled.set(key, result)
          return result
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, promise)
      return promise
    },
  }
}

// ── Pay x402 ──────────────────────────────────────────────────────────────────

export interface PayX402Params {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  credentialId?: string
}

export interface PayX402Result {
  status: number
  contentType?: string
  text: string
  payments: PayboxPaymentRecord[]
}

/** Per-request cap in atomic USDC from PAYBOX_MAX_PAYMENT_USDC (default 1 USDC). */
function perRequestCapAtomic(): string {
  const usdc = Number(process.env.PAYBOX_MAX_PAYMENT_USDC ?? "1")
  return String(Math.max(1, Math.round((Number.isFinite(usdc) ? usdc : 1) * 1_000_000)))
}

/**
 * Call an x402 endpoint, settling any 402 challenge with a USDC transfer
 * signed inside the user's Paybox grant. Works against the Shipyard gateway,
 * marketplace listings, and any external Solana-flavor x402 endpoint
 * (pay.sh skills, RelAI, the bazaar).
 */
export async function payX402(params: PayX402Params): Promise<PayX402Result> {
  const credentialId = params.credentialId ?? (await selectedWalletCredentialId())
  if (!credentialId) {
    throw new Error("No Paybox wallet selected — pick a wallet credential first (or set PAYBOX_WALLET_ID)")
  }
  const url = new URL(params.url)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs can be paid")
  }
  const network = payboxNetwork()

  // Resolve the credential's on-chain address up front and pass it as
  // `publicKey` — payboxSigner then skips its internal (registry-0.20.0) lookup
  // and signs directly within the grant.
  const credentials = await listPayboxCredentials()
  const wallet = credentials.find((c) => c.id === credentialId)
  if (!wallet) {
    throw new Error("Paybox wallet credential not found — refresh credentials on the Treasury page")
  }
  if (!wallet.address) {
    throw new Error("Selected wallet has no on-chain address in its Paybox metadata")
  }

  const client = await payboxClient()
  if (!client) {
    throw new Error("Paybox client unavailable — run `npx @paybox-sh/sdk login` or set PAYBOX_API_KEY")
  }
  // Sign with our conversion-aware signer: shipyard-inference's settle path
  // builds versioned txs, but the Paybox SDK signs legacy ones (see the
  // versioned→legacy note above), so we convert before handing bytes over.
  const signer = payboxWalletSigner({ client, credentialId, address: wallet.address, network })
  const payment = payboxSolanaPayProvider({ signer, network })
  const payments: PayboxPaymentRecord[] = []

  const payingFetch = createPayingFetch({
    paymentProvider: payment,
    spendCap: { perRequest: perRequestCapAtomic() },
    // A rejected first proof (e.g. blockhash aged out before the gateway
    // submitted) 402s with a fresh nonce; one more settle-attempt recovers.
    maxPaymentRetries: 2,
    onPayment: (result) => {
      const record: PayboxPaymentRecord = {
        at: Date.now(),
        url: params.url,
        amountAtomic: result.amount,
        network,
        reference: result.reference,
      }
      payments.push(record)
      void recordPayment(record)
    },
  })

  const init: RequestInit = {
    method: params.method ?? "GET",
    headers: {
      ...(params.headers ?? {}),
      ...(params.body ? { "content-type": "application/json" } : {}),
    },
    ...(params.body ? { body: params.body } : {}),
  }

  const res = await payingFetch(params.url, init)
  const text = (await res.text()).slice(0, 50_000)
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? undefined,
    text,
    payments,
  }
}
