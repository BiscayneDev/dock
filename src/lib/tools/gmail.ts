import { z } from 'zod'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/integrations/google'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

async function getGmailClient(ctx: UserContext): Promise<ReturnType<typeof google.gmail>> {
  const tokens = ctx.tokens.google
  if (!tokens) {
    throw new Error('Google integration not connected')
  }
  const auth = await getAuthedClient(tokens, ctx.userId)
  return google.gmail({ version: 'v1', auth })
}

// --- gmail_search ---

const SearchInput = z.object({
  query: z.string().describe('Gmail search query (same syntax as Gmail search bar)'),
  maxResults: z.number().optional().default(10).describe('Max results to return'),
})

export const gmailSearch: Tool = {
  name: 'gmail_search',
  description: 'Search emails by query, date range, sender, subject. Uses Gmail search syntax.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query' },
      maxResults: { type: 'number', description: 'Max results (default 10)' },
    },
    required: ['query'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SearchInput.parse(input)
      const gmail = await getGmailClient(ctx)

      const res = await gmail.users.messages.list({
        userId: 'me',
        q: parsed.query,
        maxResults: parsed.maxResults,
      })

      const messages = res.data.messages ?? []
      const details = await Promise.all(
        messages.slice(0, parsed.maxResults).map(async (msg) => {
          const full = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          })
          const headers = full.data.payload?.headers ?? []
          return {
            id: msg.id,
            threadId: msg.threadId,
            from: headers.find((h) => h.name === 'From')?.value ?? '',
            subject: headers.find((h) => h.name === 'Subject')?.value ?? '',
            date: headers.find((h) => h.name === 'Date')?.value ?? '',
            snippet: full.data.snippet ?? '',
          }
        })
      )

      return { success: true, data: { count: details.length, messages: details } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gmail_read ---

const ReadInput = z.object({
  messageId: z.string().describe('The Gmail message ID'),
})

export const gmailRead: Tool = {
  name: 'gmail_read',
  description: 'Read a specific email by its ID. Returns full headers and body text.',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'The Gmail message ID' },
    },
    required: ['messageId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ReadInput.parse(input)
      const gmail = await getGmailClient(ctx)

      const res = await gmail.users.messages.get({
        userId: 'me',
        id: parsed.messageId,
        format: 'full',
      })

      const headers = res.data.payload?.headers ?? []
      const parts = res.data.payload?.parts ?? []

      let body = ''
      const textPart = parts.find((p) => p.mimeType === 'text/plain')
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf8')
      } else if (res.data.payload?.body?.data) {
        body = Buffer.from(res.data.payload.body.data, 'base64').toString('utf8')
      }

      return {
        success: true,
        data: {
          id: res.data.id,
          threadId: res.data.threadId,
          from: headers.find((h) => h.name === 'From')?.value ?? '',
          to: headers.find((h) => h.name === 'To')?.value ?? '',
          subject: headers.find((h) => h.name === 'Subject')?.value ?? '',
          date: headers.find((h) => h.name === 'Date')?.value ?? '',
          body: body.slice(0, 4000),
          labels: res.data.labelIds ?? [],
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gmail_summarize_inbox ---

const SummarizeInput = z.object({
  hours: z.number().optional().default(24).describe('Look back N hours for unread emails'),
})

export const gmailSummarizeInbox: Tool = {
  name: 'gmail_summarize_inbox',
  description: 'Fetch unread emails from the last N hours. Returns summaries for LLM to synthesize.',
  inputSchema: {
    type: 'object',
    properties: {
      hours: { type: 'number', description: 'Look back N hours (default 24)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SummarizeInput.parse(input)
      const gmail = await getGmailClient(ctx)

      const afterDate = new Date(Date.now() - parsed.hours * 60 * 60 * 1000)
      const afterEpoch = Math.floor(afterDate.getTime() / 1000)

      const res = await gmail.users.messages.list({
        userId: 'me',
        q: `is:unread after:${afterEpoch}`,
        maxResults: 20,
      })

      const messages = res.data.messages ?? []
      const summaries = await Promise.all(
        messages.map(async (msg) => {
          const full = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          })
          const headers = full.data.payload?.headers ?? []
          return {
            id: msg.id,
            from: headers.find((h) => h.name === 'From')?.value ?? '',
            subject: headers.find((h) => h.name === 'Subject')?.value ?? '',
            date: headers.find((h) => h.name === 'Date')?.value ?? '',
            snippet: full.data.snippet ?? '',
          }
        })
      )

      return { success: true, data: { unreadCount: summaries.length, emails: summaries } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gmail_draft ---

const DraftInput = z.object({
  to: z.string().describe('Recipient email address'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body (plain text)'),
})

export const gmailDraft: Tool = {
  name: 'gmail_draft',
  description: 'Create an email draft.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email' },
      subject: { type: 'string', description: 'Subject line' },
      body: { type: 'string', description: 'Email body (plain text)' },
    },
    required: ['to', 'subject', 'body'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = DraftInput.parse(input)
      const gmail = await getGmailClient(ctx)

      const raw = Buffer.from(
        `To: ${parsed.to}\r\nSubject: ${parsed.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${parsed.body}`
      ).toString('base64url')

      const res = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw } },
      })

      return { success: true, data: { draftId: res.data.id, messageId: res.data.message?.id } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gmail_send ---

const SendInput = z.object({
  to: z.string().describe('Recipient email address'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body (plain text)'),
})

export const gmailSend: Tool = {
  name: 'gmail_send',
  description: 'Send an email. REQUIRES user confirmation before execution.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email' },
      subject: { type: 'string', description: 'Subject line' },
      body: { type: 'string', description: 'Email body (plain text)' },
    },
    required: ['to', 'subject', 'body'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SendInput.parse(input)
      const gmail = await getGmailClient(ctx)

      const raw = Buffer.from(
        `To: ${parsed.to}\r\nSubject: ${parsed.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${parsed.body}`
      ).toString('base64url')

      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      })

      return { success: true, data: { messageId: res.data.id, threadId: res.data.threadId } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gmail_reply ---

const ReplyInput = z.object({
  threadId: z.string().describe('Thread ID to reply to'),
  messageId: z.string().describe('Message ID being replied to'),
  body: z.string().describe('Reply body (plain text)'),
})

export const gmailReply: Tool = {
  name: 'gmail_reply',
  description: 'Reply to an email thread. REQUIRES user confirmation before execution.',
  inputSchema: {
    type: 'object',
    properties: {
      threadId: { type: 'string', description: 'Thread ID to reply to' },
      messageId: { type: 'string', description: 'Message ID being replied to' },
      body: { type: 'string', description: 'Reply body (plain text)' },
    },
    required: ['threadId', 'messageId', 'body'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ReplyInput.parse(input)
      const gmail = await getGmailClient(ctx)

      // Fetch original message to get headers for proper reply
      const original = await gmail.users.messages.get({
        userId: 'me',
        id: parsed.messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Message-ID'],
      })

      const headers = original.data.payload?.headers ?? []
      const to = headers.find((h) => h.name === 'From')?.value ?? ''
      const subject = headers.find((h) => h.name === 'Subject')?.value ?? ''
      const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
      const messageIdHeader = headers.find((h) => h.name === 'Message-ID')?.value ?? ''

      const raw = Buffer.from(
        `To: ${to}\r\nSubject: ${replySubject}\r\nIn-Reply-To: ${messageIdHeader}\r\nReferences: ${messageIdHeader}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${parsed.body}`
      ).toString('base64url')

      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw, threadId: parsed.threadId },
      })

      return { success: true, data: { messageId: res.data.id, threadId: res.data.threadId } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gmail_label ---

const LabelInput = z.object({
  messageId: z.string().describe('Message ID'),
  addLabels: z.array(z.string()).optional().describe('Label IDs to add'),
  removeLabels: z.array(z.string()).optional().describe('Label IDs to remove'),
})

export const gmailLabel: Tool = {
  name: 'gmail_label',
  description: 'Apply or remove labels from an email.',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'Message ID' },
      addLabels: { type: 'array', items: { type: 'string' }, description: 'Label IDs to add' },
      removeLabels: { type: 'array', items: { type: 'string' }, description: 'Label IDs to remove' },
    },
    required: ['messageId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = LabelInput.parse(input)
      const gmail = await getGmailClient(ctx)

      await gmail.users.messages.modify({
        userId: 'me',
        id: parsed.messageId,
        requestBody: {
          addLabelIds: parsed.addLabels ?? [],
          removeLabelIds: parsed.removeLabels ?? [],
        },
      })

      return { success: true, data: { modified: true } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gmail_archive ---

const ArchiveInput = z.object({
  messageId: z.string().describe('Message ID to archive'),
})

export const gmailArchive: Tool = {
  name: 'gmail_archive',
  description: 'Archive an email (remove INBOX label).',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'Message ID to archive' },
    },
    required: ['messageId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ArchiveInput.parse(input)
      const gmail = await getGmailClient(ctx)

      await gmail.users.messages.modify({
        userId: 'me',
        id: parsed.messageId,
        requestBody: { removeLabelIds: ['INBOX'] },
      })

      return { success: true, data: { archived: true } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}
