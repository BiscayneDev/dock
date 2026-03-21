import { z } from 'zod'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/integrations/google'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

async function getCalendarClient(ctx: UserContext): Promise<ReturnType<typeof google.calendar>> {
  const tokens = ctx.tokens.google
  if (!tokens) {
    throw new Error('Google integration not connected')
  }
  const auth = await getAuthedClient(tokens, ctx.userId)
  return google.calendar({ version: 'v3', auth })
}

// --- gcal_list_events ---

const ListEventsInput = z.object({
  timeMin: z.string().describe('Start of range (ISO 8601)'),
  timeMax: z.string().describe('End of range (ISO 8601)'),
  maxResults: z.number().optional().default(20),
})

export const gcalListEvents: Tool = {
  name: 'gcal_list_events',
  description: 'List calendar events within a date/time range.',
  inputSchema: {
    type: 'object',
    properties: {
      timeMin: { type: 'string', description: 'Start of range (ISO 8601)' },
      timeMax: { type: 'string', description: 'End of range (ISO 8601)' },
      maxResults: { type: 'number', description: 'Max results (default 20)' },
    },
    required: ['timeMin', 'timeMax'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ListEventsInput.parse(input)
      const cal = await getCalendarClient(ctx)

      const res = await cal.events.list({
        calendarId: 'primary',
        timeMin: parsed.timeMin,
        timeMax: parsed.timeMax,
        maxResults: parsed.maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      })

      const events = (res.data.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        location: e.location,
        description: e.description?.slice(0, 500),
        attendees: (e.attendees ?? []).map((a) => ({ email: a.email, status: a.responseStatus })),
        meetLink: e.hangoutLink,
      }))

      return { success: true, data: { count: events.length, events } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gcal_get_event ---

const GetEventInput = z.object({
  eventId: z.string().describe('The calendar event ID'),
})

export const gcalGetEvent: Tool = {
  name: 'gcal_get_event',
  description: 'Get full details of a specific calendar event.',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'The calendar event ID' },
    },
    required: ['eventId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = GetEventInput.parse(input)
      const cal = await getCalendarClient(ctx)

      const res = await cal.events.get({
        calendarId: 'primary',
        eventId: parsed.eventId,
      })

      const e = res.data
      return {
        success: true,
        data: {
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          location: e.location,
          description: e.description,
          attendees: (e.attendees ?? []).map((a) => ({
            email: a.email,
            status: a.responseStatus,
            organizer: a.organizer,
          })),
          meetLink: e.hangoutLink,
          status: e.status,
          recurrence: e.recurrence,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gcal_create_event ---

const CreateEventInput = z.object({
  summary: z.string().describe('Event title'),
  start: z.string().describe('Start time (ISO 8601)'),
  end: z.string().describe('End time (ISO 8601)'),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional().describe('Email addresses of attendees'),
})

export const gcalCreateEvent: Tool = {
  name: 'gcal_create_event',
  description: 'Create a new calendar event. Confirm with user first if inviting attendees.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Event title' },
      start: { type: 'string', description: 'Start time (ISO 8601)' },
      end: { type: 'string', description: 'End time (ISO 8601)' },
      description: { type: 'string', description: 'Event description' },
      location: { type: 'string', description: 'Event location' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee emails' },
    },
    required: ['summary', 'start', 'end'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = CreateEventInput.parse(input)
      const cal = await getCalendarClient(ctx)

      const res = await cal.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: parsed.summary,
          start: { dateTime: parsed.start },
          end: { dateTime: parsed.end },
          description: parsed.description,
          location: parsed.location,
          attendees: parsed.attendees?.map((email) => ({ email })),
        },
      })

      return {
        success: true,
        data: {
          id: res.data.id,
          summary: res.data.summary,
          start: res.data.start?.dateTime,
          end: res.data.end?.dateTime,
          htmlLink: res.data.htmlLink,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gcal_update_event ---

const UpdateEventInput = z.object({
  eventId: z.string().describe('Event ID to update'),
  summary: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
})

export const gcalUpdateEvent: Tool = {
  name: 'gcal_update_event',
  description: 'Update an existing calendar event.',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'Event ID' },
      summary: { type: 'string', description: 'New title' },
      start: { type: 'string', description: 'New start time (ISO 8601)' },
      end: { type: 'string', description: 'New end time (ISO 8601)' },
      description: { type: 'string', description: 'New description' },
      location: { type: 'string', description: 'New location' },
    },
    required: ['eventId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = UpdateEventInput.parse(input)
      const cal = await getCalendarClient(ctx)

      const body: Record<string, unknown> = {}
      if (parsed.summary) body.summary = parsed.summary
      if (parsed.description) body.description = parsed.description
      if (parsed.location) body.location = parsed.location
      if (parsed.start) body.start = { dateTime: parsed.start }
      if (parsed.end) body.end = { dateTime: parsed.end }

      const res = await cal.events.patch({
        calendarId: 'primary',
        eventId: parsed.eventId,
        requestBody: body,
      })

      return {
        success: true,
        data: { id: res.data.id, summary: res.data.summary, updated: true },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gcal_delete_event ---

const DeleteEventInput = z.object({
  eventId: z.string().describe('Event ID to delete'),
})

export const gcalDeleteEvent: Tool = {
  name: 'gcal_delete_event',
  description: 'Delete a calendar event. REQUIRES user confirmation before execution.',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'Event ID to delete' },
    },
    required: ['eventId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = DeleteEventInput.parse(input)
      const cal = await getCalendarClient(ctx)

      await cal.events.delete({
        calendarId: 'primary',
        eventId: parsed.eventId,
      })

      return { success: true, data: { deleted: true } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gcal_find_free_time ---

const FindFreeTimeInput = z.object({
  timeMin: z.string().describe('Start of window (ISO 8601)'),
  timeMax: z.string().describe('End of window (ISO 8601)'),
  durationMinutes: z.number().describe('Desired slot duration in minutes'),
})

export const gcalFindFreeTime: Tool = {
  name: 'gcal_find_free_time',
  description: 'Find free time slots within a time window.',
  inputSchema: {
    type: 'object',
    properties: {
      timeMin: { type: 'string', description: 'Start of window (ISO 8601)' },
      timeMax: { type: 'string', description: 'End of window (ISO 8601)' },
      durationMinutes: { type: 'number', description: 'Desired slot duration in minutes' },
    },
    required: ['timeMin', 'timeMax', 'durationMinutes'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = FindFreeTimeInput.parse(input)
      const cal = await getCalendarClient(ctx)

      const res = await cal.events.list({
        calendarId: 'primary',
        timeMin: parsed.timeMin,
        timeMax: parsed.timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      })

      const events = res.data.items ?? []
      const busySlots = events
        .filter((e) => e.start?.dateTime && e.end?.dateTime)
        .map((e) => ({
          start: new Date(e.start!.dateTime!).getTime(),
          end: new Date(e.end!.dateTime!).getTime(),
        }))

      const windowStart = new Date(parsed.timeMin).getTime()
      const windowEnd = new Date(parsed.timeMax).getTime()
      const durationMs = parsed.durationMinutes * 60 * 1000

      const freeSlots: Array<{ start: string; end: string }> = []
      let cursor = windowStart

      for (const busy of busySlots) {
        if (busy.start - cursor >= durationMs) {
          freeSlots.push({
            start: new Date(cursor).toISOString(),
            end: new Date(busy.start).toISOString(),
          })
        }
        cursor = Math.max(cursor, busy.end)
      }

      if (windowEnd - cursor >= durationMs) {
        freeSlots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(windowEnd).toISOString(),
        })
      }

      return { success: true, data: { freeSlots } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- gcal_today_briefing ---

export const gcalTodayBriefing: Tool = {
  name: 'gcal_today_briefing',
  description: "Get a formatted summary of today's calendar events.",
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const cal = await getCalendarClient(ctx)

      const now = new Date()
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)

      const res = await cal.events.list({
        calendarId: 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: ctx.timezone,
      })

      const events = (res.data.items ?? []).map((e) => ({
        summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        location: e.location,
        meetLink: e.hangoutLink,
      }))

      return { success: true, data: { date: now.toISOString().split('T')[0], eventCount: events.length, events } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}
