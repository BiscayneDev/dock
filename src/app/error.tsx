'use client'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: "'Lora', serif",
      background: 'var(--cream, #faf8f2)',
      color: 'var(--ink, #1a1a1a)',
    }}>
      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.75rem' }}>
        Something went wrong
      </h1>
      <p style={{ opacity: 0.6, marginBottom: '1.5rem', textAlign: 'center', maxWidth: '24rem' }}>
        {error.message || 'An unexpected error occurred. Try again or head back to port.'}
      </p>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          onClick={reset}
          className="dock-btn-primary"
          style={{ padding: '0.6rem 1.25rem' }}
        >
          Try again
        </button>
        <a href="/harbor" className="dock-btn-secondary" style={{ padding: '0.6rem 1.25rem' }}>
          Back to Harbor
        </a>
      </div>
    </div>
  )
}
