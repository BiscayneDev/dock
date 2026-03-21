import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET(): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #5BA7CD 0%, #94C4A3 30%, #E8D368 60%, #E48D6C 100%)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#EAE6D7',
            border: '3px solid #102A22',
            borderRadius: '2.5rem',
            padding: '60px 80px',
            maxWidth: '900px',
          }}
        >
          {/* Logo */}
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#102A22"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 21h14M12 21v-12M8 6c1.5 0 4-3 4-3s2.5 3 4 3" />
          </svg>

          {/* Title */}
          <div
            style={{
              fontSize: '72px',
              fontWeight: 800,
              color: '#102A22',
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              marginTop: '16px',
              textAlign: 'center',
            }}
          >
            Dock
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: '28px',
              color: '#102A22',
              opacity: 0.6,
              marginTop: '12px',
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            Your AI first mate, always on deck
          </div>

          {/* Capabilities */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginTop: '32px',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {['Email', 'Calendar', 'GitHub', 'Notion', 'Crypto', 'Recipes'].map((cap) => (
              <div
                key={cap}
                style={{
                  border: '1.5px solid #102A22',
                  borderRadius: '2rem',
                  padding: '8px 20px',
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#102A22',
                }}
              >
                {cap}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
