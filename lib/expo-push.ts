/**
 * Expo push delivery for Dock notifications.
 *
 * The mobile app registers its Expo push token (POST /api/mobile/push-token,
 * mobile-token auth) and can revoke it (DELETE same route). POST /api/notify
 * and the run worker fan out to these devices through the Expo Push Service,
 * which handles APNs. Tokens are device identifiers: they live in the private
 * store (~/.config/dock/private/push-tokens.json, 0600, no symlinks), not in
 * the application tree. Devices the service reports DeviceNotRegistered are
 * pruned.
 */
import path from "node:path"
import { readPrivateStore, writePrivateStore } from "./private-store.ts"
import { dockPrivateDir } from "./private-dir.ts"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

export interface PushTokenRecord {
  token: string
  platform: string
  deviceId?: string
  registeredAt: string
}

async function defaultFile(): Promise<string> {
  return path.join(await dockPrivateDir(), "push-tokens.json")
}

export function isValidExpoPushToken(token: string): boolean {
  return /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token) || /^ExpoPushToken\[[A-Za-z0-9_-]+\]$/.test(token)
}

export async function listPushTokens(file?: string): Promise<PushTokenRecord[]> {
  const data = await readPrivateStore(file ?? (await defaultFile()))
  return Array.isArray(data) ? (data as PushTokenRecord[]) : []
}

export async function registerPushToken(
  token: string,
  platform: string,
  deviceId?: string,
  file?: string,
): Promise<void> {
  if (!isValidExpoPushToken(token)) throw new Error("not an Expo push token")
  const target = file ?? (await defaultFile())
  const tokens = await listPushTokens(target)
  if (!tokens.some((t) => t.token === token)) {
    tokens.push({ token, platform, deviceId, registeredAt: new Date().toISOString() })
    await writePrivateStore(target, tokens)
  }
}

export async function unregisterPushToken(token: string, file?: string): Promise<boolean> {
  const target = file ?? (await defaultFile())
  const tokens = await listPushTokens(target)
  const kept = tokens.filter((t) => t.token !== token)
  if (kept.length === tokens.length) return false
  await writePrivateStore(target, kept)
  return true
}

interface ExpoPushTicket {
  status: "ok" | "error"
  details?: { error?: string }
}

/**
 * Send a notification to every registered device. Best-effort: never throws.
 * Returns the number of devices the message was handed to, for observability.
 */
export async function sendExpoPush(
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  file?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const target = file ?? (await defaultFile())
  const tokens = await listPushTokens(target)
  if (tokens.length === 0) return 0
  const messages = tokens.map((t) => ({ to: t.token, sound: "default", title, body, data }))
  let tickets: ExpoPushTicket[] = []
  try {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    })
    const parsed = (await res.json()) as { data?: ExpoPushTicket[] }
    tickets = parsed.data ?? []
  } catch {
    return 0
  }
  // Prune dead devices so the list does not grow stale.
  const dead = tokens.filter((_, i) => tickets[i]?.details?.error === "DeviceNotRegistered")
  for (const d of dead) await unregisterPushToken(d.token, target).catch(() => false)
  return tickets.filter((t) => t.status === "ok").length
}
