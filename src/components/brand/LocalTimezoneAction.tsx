'use client'

/** Save the browser IANA zone for the first Google connect. Do not trust it as identity. */
export default function LocalTimezoneAction({ href, label, className }: { href: string; label: string; className: string }) {
  return <a className={className} href={href} onClick={() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (timezone) document.cookie = `dinghy_connect_tz=${encodeURIComponent(timezone)}; Path=/; Max-Age=900; SameSite=Lax; Secure`
  }}>{label}</a>
}
