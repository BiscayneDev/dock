/**
 * Expo push delivery for Dock notifications.
 *
 * The mobile app registers its Expo push token (POST /api/mobile/push-token,
 * mobile-token auth). POST /api/notify fans out to these devices through the
 * Expo Push Service, which handles APNs. Tokens are device identifiers, not
 * secrets, and live in data/push-tokens.json next to the other local stores.
 * Devices the service reports as DeviceNotRegistered are pruned.
 */
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname, join } from "path"

const DATA_PATH = join(process.cwd(), "data", "push-tokens.json")
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

export interface PushTokenRecord {
  token: string
  platform: string
  registeredAt: string
}

export function isValidExpoPushToken(token: string): boolean {
  return /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token) || /^ExpoPushToken\[[A-Za-z0-9_-]+\]$/.test(token)
}

export async function listPushTokens(path: string = DATA_PATH): Promise<PushTokenRecord[]> {
  try {
    const raw = await readFile(path, "utf-8")
    const data = JSON.parse(raw)
    return Array.isArray(data) ? (data as PushTokenRecord[]) : []
  } catch {
    return []
  }
}

export async function registerPushToken(
  token: string,
  platform: string,
  path: string = DATA_PATH,
): Promise<void> {
  if (!isValidExpoPushToken(token)) throw new Error("not an Expo push token")
  const tokens = await listPushTokens(path)
  if (!tokens.some((t) => t.token === token)) {
    tokens.push({ token, platform, registeredAt: new Date().toISOString() })
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(tokens, null, 2), "utf-8")
  }
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
  path: string = DATA_PATH,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const tokens = await listPushTokens(path)
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
  if (dead.length > 0) {
    const alive = tokens.filter((t) => !dead.some((d) => d.token === t.token))
    await writeFile(path, JSON.stringify(alive, null, 2), "utf-8").catch(() => {})
  }
  return tickets.filter((t) => t.status === "ok").length
}
