import type { Metadata } from 'next'
import { PaperPage } from '@/components/brand/PaperPage'

const SITE_URL = 'https://www.getdinghy.sh'

export const metadata: Metadata = {
  title: 'GitHub connected',
  description: 'GitHub is connected — back to your texts, Dinghy has it from here.',
  openGraph: {
    type: 'website',
    title: 'GitHub connected',
    description: 'GitHub is connected — back to your texts, Dinghy has it from here.',
    siteName: 'Dinghy',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'Dinghy · Your first mate, one text away',
        type: 'image/png',
      },
    ],
  },
  robots: { index: false, follow: false },
  metadataBase: new URL(SITE_URL),
}

export default function ConnectGithubSuccessPage(): React.JSX.Element {
  return (
    <PaperPage
      label="dinghy · connected"
      title="github is"
      accent="on board"
      body="Back to your texts. Dinghy has it from here, and your original request is already on its way in the chat."
      fine="You can close this tab."
    />
  )
}
