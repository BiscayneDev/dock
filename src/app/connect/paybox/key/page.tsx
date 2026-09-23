import type { Metadata } from 'next'
import { PaperPage } from '@/components/brand/PaperPage'
import { keyLinkIsLive } from '@/lib/integrations/paybox-key-link'
import { KeyForm } from './KeyForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Add your PayBox signing key',
  description: 'Paste the signing key from PayBox so Dinghy can finish what you approve.',
  robots: { index: false, follow: false },
  metadataBase: new URL('https://www.getdinghy.sh'),
}

export default async function PayboxKeyPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>
}): Promise<React.JSX.Element> {
  const { t } = await searchParams
  const live = t ? await keyLinkIsLive(t).catch(() => false) : false

  return (
    <PaperPage
      label="dinghy · paybox"
      title="paste your"
      accent="signing key"
      body="Copy the key PayBox just made for Dinghy and paste it here. It's saved encrypted, never shown again, and never goes through your texts."
      missing={live ? undefined : 'This link expired or was already used. Ask Dinghy for a fresh one.'}
      fine="Set limits on the key in PayBox. Anything over them still waits for your passkey, and you can revoke it from PayBox's clients screen any time."
    >
      {live && t ? <KeyForm token={t} /> : null}
    </PaperPage>
  )
}
