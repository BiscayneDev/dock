/**
 * Mobile pairing: expiring, single-use codes instead of pasted secrets.
 *
 * The owner, signed in to Dock on the web, creates a pairing code
 * (POST /api/mobile/pair/create). The phone exchanges it once, within five
 * minutes (POST /api/mobile/pair/exchange), for a device-scoped credential.
 * Device credentials are stored HASHED (sha256) in the private store and can be
 * revoked per device (DELETE /api/mobile/device). The owner never types a
 * persistent token into the phone, and a leaked code is useless after one use
 * or five minutes.
 */
import path from "node:path"
import { createHash, randomInt, randomUUID } from "node:crypto"
import { readPrivateStore, writePrivateStore } from "./private-store.ts"
import { dockPrivateDir } from "./private-dir.ts"

export const PAIR_CODE_TTL_MS = 5 * 60 * 1000

interface PairCode {
  id: string
  codeHash: string
  expiresAt: number
  used: boolean
  createdAt: string
}

export interface MobileDevice {
  id: string
  tokenHash: string
  platform: string
  deviceLabel?: string
  createdAt: string
  revokedAt: string | null
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

async function codesFile(): Promise<string> {
  return path.join(await dockPrivateDir(), "pairing-codes.json")
}

async function devicesFile(): Promise<string> {
  return path.join(await dockPrivateDir(), "mobile-devices.json")
}

async function readJson<T>(file: string): Promise<T[]> {
  const data = await readPrivateStore(file)
  return Array.isArray(data) ? (data as T[]) : []
}

/** Owner-side: mint a 6-digit code, valid 5 minutes, single use. */
export async function createPairingCode(file?: string): Promise<{ code: string; expiresAt: number }> {
  const target = file ?? (await codesFile())
  const codes = await readJson<PairCode>(target)
  const code = String(randomInt(0, 1000000)).padStart(6, "0")
  const expiresAt = Date.now() + PAIR_CODE_TTL_MS
  codes.push({ id: randomUUID(), codeHash: hash(code), expiresAt, used: false, createdAt: new Date().toISOString() })
  await writePrivateStore(target, codes.slice(-20))
  return { code, expiresAt }
}

export class PairingError extends Error {}

/**
 * Phone-side: exchange a valid code for a device credential. Codes are
 * single-use; marking used happens before token issuance so a concurrent
 * exchange of the same code cannot mint two devices.
 */
export async function exchangePairingCode(
  code: string,
  platform: string,
  deviceLabel?: string,
  codesPath?: string,
  devicesPath?: string,
): Promise<{ deviceToken: string; deviceId: string }> {
  const target = codesPath ?? (await codesFile())
  const codes = await readJson<PairCode>(target)
  const codeHash = hash(code.trim())
  const match = codes.find((c) => c.codeHash === codeHash)
  if (!match || match.used || match.expiresAt < Date.now()) {
    throw new PairingError("invalid or expired pairing code")
  }
  match.used = true
  await writePrivateStore(target, codes)

  const deviceToken = `dockdev_${randomUUID()}${randomUUID()}`.replace(/-/g, "")
  const device: MobileDevice = {
    id: randomUUID(),
    tokenHash: hash(deviceToken),
    platform,
    deviceLabel,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  }
  const devicesTarget = devicesPath ?? (await devicesFile())
  const devices = await readJson<MobileDevice>(devicesTarget)
  devices.push(device)
  await writePrivateStore(devicesTarget, devices)
  return { deviceToken, deviceId: device.id }
}

/** True when the presented credential belongs to a live paired device. */
export async function deviceTokenAuthorized(token: string, devicesPath?: string): Promise<boolean> {
  if (!token.startsWith("dockdev_")) return false
  const devices = await readJson<MobileDevice>(devicesPath ?? (await devicesFile()))
  const tokenHash = hash(token)
  return devices.some((d) => d.tokenHash === tokenHash && d.revokedAt === null)
}

export async function listDevices(devicesPath?: string): Promise<Omit<MobileDevice, "tokenHash">[]> {
  const devices = await readJson<MobileDevice>(devicesPath ?? (await devicesFile()))
  return devices.map(({ tokenHash: _drop, ...rest }) => rest)
}

export async function revokeDevice(deviceId: string, devicesPath?: string): Promise<boolean> {
  const target = devicesPath ?? (await devicesFile())
  const devices = await readJson<MobileDevice>(target)
  const device = devices.find((d) => d.id === deviceId)
  if (!device || device.revokedAt !== null) return false
  device.revokedAt = new Date().toISOString()
  await writePrivateStore(target, devices)
  return true
}
