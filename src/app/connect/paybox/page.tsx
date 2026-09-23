import type { Metadata } from 'next'

const SITE_URL = 'https://www.getdinghy.sh'

export const metadata: Metadata = {
  title: 'Connect your PayBox wallet',
  description:
    'Sign in with your email + passkey and Dinghy can read your wallet balances. Nothing moves without your passkey.',
  openGraph: {
    type: 'website',
    title: 'Connect your PayBox wallet',
    description:
      'Sign in with your email + passkey and Dinghy can read your wallet balances. Nothing moves without your passkey.',
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
  twitter: {
    card: 'summary_large_image',
    title: 'Connect your PayBox wallet',
    description:
      'Sign in with your email + passkey and Dinghy can read your wallet balances. Nothing moves without your passkey.',
    images: ['/api/og'],
  },
  robots: { index: false, follow: false },
  metadataBase: new URL(SITE_URL),
}

export default async function ConnectPayboxPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}): Promise<React.JSX.Element> {
  const { connect } = await searchParams
  const authHref = connect
    ? `/api/integrations/paybox/auth?connect=${encodeURIComponent(connect)}`
    : null

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
        <h1
          style={{
            fontSize: '28px',
            fontWeight: 800,
            color: '#102A22',
            letterSpacing: '-0.02em',
            margin: '20px 0 8px',
          }}
        >
          Connect your PayBox wallet
        </h1>
        <p style={{ fontSize: '16px', color: '#102A22', opacity: 0.7, margin: '0 0 32px', lineHeight: 1.5 }}>
          Sign in with your email + passkey and Dinghy can read your wallet balances. Nothing moves without your passkey.
        </p>
        {authHref ? (
          <a
            href={authHref}
            style={{
              display: 'inline-block',
              backgroundColor: '#102A22',
              color: '#EAE6D7',
              fontSize: '17px',
              fontWeight: 700,
              padding: '14px 32px',
              borderRadius: '2rem',
              textDecoration: 'none',
            }}
          >
            Connect with PayBox
          </a>
        ) : (
          <p style={{ fontSize: '15px', color: '#102A22', opacity: 0.7 }}>
            This link is missing its token. Ask Dinghy for a fresh one.
          </p>
        )}
        <p style={{ fontSize: '13px', color: '#102A22', opacity: 0.5, marginTop: '28px' }}>
          You approve in PayBox itself — Dinghy never holds your keys.
        </p>
      </div>
    </main>
  )
}
