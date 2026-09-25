/** One editable, useful request that works before connecting any account. */
export const FIRST_TASK = 'Find three useful AI stories from today and give me the sources.'

export function startSmsLink(line: string): string {
  return `sms:${line}?&body=${encodeURIComponent(FIRST_TASK)}`
}

export function startLink(token: string): string {
  return `https://www.getdinghy.sh/start/${encodeURIComponent(token)}`
}
