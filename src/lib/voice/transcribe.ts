import { logger } from '@/lib/logger'

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
const TELEGRAM_FILE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

interface TranscriptionResult {
  text: string
  language?: string
}

/**
 * Download a voice file from Telegram and transcribe it using ElevenLabs Scribe.
 */
export async function transcribeVoiceMessage(fileId: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured')
  }

  // Step 1: Get file path from Telegram
  const fileInfoRes = await fetch(`${TELEGRAM_FILE_URL}/getFile?file_id=${fileId}`)
  const fileInfo = (await fileInfoRes.json()) as {
    ok: boolean
    result?: { file_path: string }
  }

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Failed to get file info from Telegram')
  }

  // Step 2: Download the voice file
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`
  const fileRes = await fetch(fileUrl)

  if (!fileRes.ok) {
    throw new Error(`Failed to download voice file: ${fileRes.statusText}`)
  }

  const fileBuffer = await fileRes.arrayBuffer()

  // Determine file extension from path
  const filePath = fileInfo.result.file_path
  const extension = filePath.split('.').pop() ?? 'ogg'

  // Step 3: Transcribe with ElevenLabs Scribe
  const formData = new FormData()
  formData.append('file', new Blob([fileBuffer]), `voice.${extension}`)
  formData.append('model_id', 'scribe_v1')

  const transcribeRes = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: formData,
  })

  if (!transcribeRes.ok) {
    const errorText = await transcribeRes.text()
    logger.error('ElevenLabs transcription failed', {
      status: transcribeRes.status,
      error: errorText,
    })
    throw new Error(`Transcription failed: ${transcribeRes.status}`)
  }

  const result = (await transcribeRes.json()) as TranscriptionResult

  if (!result.text || result.text.trim().length === 0) {
    throw new Error('Transcription returned empty text')
  }

  logger.info('Voice message transcribed', {
    language: result.language,
    length: result.text.length,
  })

  return result.text.trim()
}
