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
