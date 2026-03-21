import { createHmac, createHash } from 'crypto'
import { z } from 'zod'

export const TelegramLoginDataSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
})

export type TelegramLoginData = z.infer<typeof TelegramLoginDataSchema>

export function verifyTelegramAuth(data: TelegramLoginData): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set')
  }

  // Reject if auth_date is older than 24 hours
  const authAge = Math.floor(Date.now() / 1000) - data.auth_date
  if (authAge > 86400) {
    return false
  }

  // Build the data-check-string: sorted key=value pairs (excluding hash)
  const checkString = Object.entries(data)
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  // Secret key = SHA256(bot_token)
  const secretKey = createHash('sha256').update(botToken).digest()

  // Hash = HMAC-SHA256(data_check_string, secret_key)
  const computedHash = createHmac('sha256', secretKey)
    .update(checkString)
    .digest('hex')

  return computedHash === data.hash
}
