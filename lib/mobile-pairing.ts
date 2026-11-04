/**
 * Mobile pairing: expiring, single-use codes instead of pasted secrets.
 *
 * The owner, signed in to Dock on the web, creates a pairing code
 * (POST /api/mobile/pair/create). The phone exchanges it once, within five
 * minutes (POST /api/mobile/pair/exchange), for a device-scoped credential.
 * Device credentials are stored HASHED (sha256) and can be revoked per device.
 *
 * Correctness lives in the store contract below: the code consume is one
 * atomic operation (a SELECT ... FOR UPDATE + UPDATE inside a Postgres
 * function for the Supabase store - see migration 20261104_mobile_pairings -
 * and a serialized critical section for the in-memory test store), so two
 * concurrent exchanges of one code mint exactly one credential. Failed
 * exchanges are recorded and bounded per workspace per window at the store
 * level, so guessing is rate-limited regardless of which app instance answers.
 */
import { createHash, randomInt, randomUUID } from "node:crypto"

export const PAIR_CODE_TTL_MS = 5 * 60 * 1000
export const PAIR_MAX_FAILURES = 10
export const PAIR_FAILURE_WINDOW_MS = 5 * 60 * 1000

export interface MobileDevice {
  id: string
  tokenHash: string
  platform: string
  deviceLabel?: string
  createdAt: string
  revokedAt: string | null
}

export type ExchangeOutcome = "ok" | "invalid" | "rate_limited"

export interface MobilePairingStore {
  createPairing(workspaceId: string, codeHash: string, expiresAt: Date): Promise<void>
  /** Atomically check-and-consume a code, recording and bounding failures. */
  consumePairing(
    workspaceId: string,
    codeHash: string,
    maxFailures: number,
    windowMs: number,
  ): Promise<ExchangeOutcome>
  insertDevice(workspaceId: string, device: MobileDevice): Promise<void>
  findLiveDeviceByTokenHash(tokenHash: string): Promise<MobileDevice | null>
  listDevices(workspaceId: string): Promise<MobileDevice[]>
  revokeDevice(workspaceId: string, deviceId: string): Promise<boolean>
}

export function hashMobileSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** Owner-side: mint a 6-digit code, valid 5 minutes, single use. */
export async function createPairingCode(
  store: MobilePairingStore,
  workspaceId: string,
): Promise<{ code: string; expiresAt: number }> {
  const code = String(randomInt(0, 1000000)).padStart(6, "0")
  const expiresAt = Date.now() + PAIR_CODE_TTL_MS
  await store.createPairing(workspaceId, hashMobileSecret(code), new Date(expiresAt))
  return { code, expiresAt }
}

export class PairingError extends Error {
  readonly outcome: Exclude<ExchangeOutcome, "ok">
  constructor(message: string, outcome: Exclude<ExchangeOutcome, "ok">) {
    super(message)
    this.outcome = outcome
  }
}

/**
 * Phone-side: exchange a valid code for a device credential. The consume and
 * the failure accounting are one atomic store operation; the device insert
 * happens only after the store reports the caller won the code.
 */
export async function exchangePairingCode(
  store: MobilePairingStore,
  workspaceId: string,
  code: string,
  platform: string,
  deviceLabel?: string,
): Promise<{ deviceToken: string; deviceId: string }> {
  const outcome = await store.consumePairing(
    workspaceId,
    hashMobileSecret(code.trim()),
    PAIR_MAX_FAILURES,
    PAIR_FAILURE_WINDOW_MS,
  )
  if (outcome === "rate_limited") {
    throw new PairingError("too many failed attempts - try again later", "rate_limited")
  }
  if (outcome !== "ok") {
    throw new PairingError("invalid or expired pairing code", "invalid")
  }
  const deviceToken = `dockdev_${randomUUID()}${randomUUID()}`.replace(/-/g, "")
  const device: MobileDevice = {
    id: randomUUID(),
    tokenHash: hashMobileSecret(deviceToken),
    platform,
    deviceLabel,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  }
  await store.insertDevice(workspaceId, device)
  return { deviceToken, deviceId: device.id }
}

/** True when the presented credential belongs to a live paired device. */
export async function deviceTokenAuthorized(store: MobilePairingStore, token: string): Promise<boolean> {
  if (!token.startsWith("dockdev_")) return false
  return (await store.findLiveDeviceByTokenHash(hashMobileSecret(token))) !== null
}

export async function listDevices(
  store: MobilePairingStore,
  workspaceId: string,
): Promise<Omit<MobileDevice, "tokenHash">[]> {
  const devices = await store.listDevices(workspaceId)
  return devices.map(({ tokenHash: _drop, ...rest }) => rest)
}

export async function revokeDevice(
  store: MobilePairingStore,
  workspaceId: string,
  deviceId: string,
): Promise<boolean> {
  return store.revokeDevice(workspaceId, deviceId)
}

/**
 * In-memory store for tests and local development without Supabase. The
 * consume critical section is serialized on a promise queue, mirroring the
 * row lock the Postgres function takes, so the concurrency contract the app
 * relies on is the same in tests.
 */
interface MemPairing {
  workspaceId: string
  codeHash: string
  used: boolean
  expiresAt: number
  createdAt: number
}

export function memoryMobilePairingStore(): MobilePairingStore {
  const pairings: MemPairing[] = []
  const failures: { workspaceId: string; at: number }[] = []
  const devices: (MobileDevice & { workspaceId: string })[] = []
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(fn: () => T): Promise<T> => {
    const run = queue.then(fn)
    queue = run.catch(() => null)
    return run
  }
  return {
    async createPairing(workspaceId, codeHash, expiresAt) {
      pairings.push({ workspaceId, codeHash, used: false, expiresAt: expiresAt.getTime(), createdAt: Date.now() })
    },
    consumePairing(workspaceId, codeHash, maxFailures, windowMs) {
      return serialized(() => {
        const windowStart = Date.now() - windowMs
        const recent = failures.filter((f) => f.workspaceId === workspaceId && f.at > windowStart)
        if (recent.length >= maxFailures) return "rate_limited"
        const row = [...pairings]
          .filter((p) => p.workspaceId === workspaceId && p.codeHash === codeHash)
          .sort((a, b) => b.createdAt - a.createdAt)[0]
        if (!row || row.used || row.expiresAt < Date.now()) {
          failures.push({ workspaceId, at: Date.now() })
          return "invalid"
        }
        row.used = true
        return "ok"
      })
    },
    async insertDevice(workspaceId, device) {
      devices.push({ ...device, workspaceId })
    },
    async findLiveDeviceByTokenHash(tokenHash) {
      const d = devices.find((x) => x.tokenHash === tokenHash && x.revokedAt === null)
      return d ? { ...d } : null
    },
    async listDevices(workspaceId) {
      return devices.filter((d) => d.workspaceId === workspaceId).map(({ workspaceId: _d, ...rest }) => rest)
    },
    async revokeDevice(workspaceId, deviceId) {
      const d = devices.find((x) => x.workspaceId === workspaceId && x.id === deviceId)
      if (!d || d.revokedAt !== null) return false
      d.revokedAt = new Date().toISOString()
      return true
    },
  }
}
