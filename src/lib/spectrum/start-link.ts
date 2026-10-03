/** Editable first requests that work without connecting an account. */
export const START_TASKS = [
  { label: 'Find three useful AI stories today, with sources', text: 'Find three useful AI stories from today and give me the publication dates and sources.' },
  { label: 'Draft a warm text to get out of dinner tonight', text: "Draft a warm, direct text saying I can't make dinner tonight. Don't invent a reason." },
  { label: 'Ask my own question', text: '' },
] as const

export function startSmsLink(line: string, text: string = START_TASKS[0].text): string {
  return text ? `sms:${line}?&body=${encodeURIComponent(text)}` : `sms:${line}`
}

export function startLink(token: string): string {
  return `https://www.getdinghy.sh/start/${encodeURIComponent(token)}`
}

/** A start token may open Google connect only for a live waitlist row with a real phone. */
export function startGoogleEligible(row: { phone?: string | null; status?: string | null } | null | undefined): boolean {
  return !!row && ['joined', 'invited', 'active'].includes(row.status ?? '') && /^\+[1-9]\d{7,14}$/.test(row.phone ?? '')
}

export function startGooglePath(token: string): string {
  return `/start/${encodeURIComponent(token)}/google`
}

/** The pending request the start page attaches to its Google connect. Still reads as a plain connect request. */
export const START_CONNECT_REQUEST = 'connect my gmail from start'

/** The first message the start page prefills. Short on purpose, they can edit it. */
export const START_FIRST_TEXT = 'Hi'

export function startReadyPath(token: string): string {
  return `/start/${encodeURIComponent(token)}/ready`
}

export type FirstLookStatus = 'pending' | 'ready' | 'empty' | 'failed' | 'sent'

/** What the ready page shows for the first look. Never carries the text itself. */
export function firstLookCopy(status: FirstLookStatus | null | undefined): { title: string; body: string; done: boolean } {
  switch (status) {
    case 'ready':
      return { title: 'Your first look is ready', body: 'It lands in your first reply, as soon as you text.', done: true }
    case 'empty':
      return { title: 'Your calendar and inbox look quiet', body: 'Nothing to flag yet. Text me one thing you want off your plate.', done: true }
    case 'failed':
      return { title: 'I could not finish my first look', body: 'Your number works either way. Text me "look at my day" and I will try again.', done: true }
    case 'sent':
      return { title: 'Your first look is in your texts', body: 'Open Messages, it is waiting there.', done: true }
    default:
      return { title: 'Taking a first look', body: 'Reading your calendar and inbox headers. This takes about a minute.', done: false }
  }
}
