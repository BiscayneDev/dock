import type { Metadata } from 'next'

const SITE_URL = 'https://www.getdinghy.sh'

export const metadata: Metadata = {
  title: 'Google connected',
  description: 'Google is connected — back to your texts, Dinghy has it from here.',
  openGraph: {
    type: 'website',
    title: 'Google connected',
    description: 'Google is connected — back to your texts, Dinghy has it from here.',
    siteName: 'Dinghy',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'Dinghy — Your AI first mate, always on deck',
        type: 'image/png',
      },
    ],
  },
  robots: { index: false, follow: false },
  metadataBase: new URL(SITE_URL),
}

export default function ConnectSuccessPage(): React.JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #5BA7CD 0%, #94C4A3 30%, #E8D368 60%, #E48D6C 100%)',
        fontFamily: 'system-ui, sans-serif',
        padding: '24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          backgroundColor: '#EAE6D7',
          border: '3px solid #102A22',
          borderRadius: '2rem',
          padding: '48px 40px',
          maxWidth: '420px',
          width: '100%',
          textAlign: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Dinghy" width={72} height={72} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            margin: '24px 0 8px',
            backgroundColor: '#102A22',
            color: '#EAE6D7',
            borderRadius: '2rem',
            padding: '10px 24px',
            fontSize: '17px',
            fontWeight: 700,
          }}
        >
          <span aria-hidden="true">✓</span> Google connected
        </div>
        <p style={{ fontSize: '16px', color: '#102A22', opacity: 0.7, margin: '16px 0 0', lineHeight: 1.5 }}>
          Back to your texts — Dinghy's got it from here. Your original request is already on its way in the chat.
        </p>
        <p style={{ fontSize: '13px', color: '#102A22', opacity: 0.5, marginTop: '28px' }}>
          You can close this tab.
        </p>
      </div>
    </main>
  )
}
