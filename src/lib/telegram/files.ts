import { logger } from '@/lib/logger'

// Download a Telegram file (getFile + fetch) and return it base64-encoded.
// Used for image/document attachments; mirrors the flow in voice/transcribe.ts.

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

export interface DownloadedFile {
  dataBase64: string
  mimeType: string
  filePath: string
}

export async function downloadTelegramFile(fileId: string): Promise<DownloadedFile | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null

  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
    const info = (await infoRes.json()) as { ok: boolean; result?: { file_path: string } }
    if (!info.ok || !info.result?.file_path) return null

    const filePath = info.result.file_path
    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
    if (!fileRes.ok) return null

    const buffer = Buffer.from(await fileRes.arrayBuffer())
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream'

    return { dataBase64: buffer.toString('base64'), mimeType, filePath }
  } catch (err) {
    logger.error('downloadTelegramFile failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
