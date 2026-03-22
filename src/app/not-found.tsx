import Link from 'next/link'

export default function NotFound() {
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
      <p style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>⚓</p>
      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.75rem' }}>
        Off the charts
      </h1>
      <p style={{ opacity: 0.6, marginBottom: '1.5rem', textAlign: 'center', maxWidth: '24rem' }}>
        This page doesn&apos;t exist. Let&apos;s get you back on course.
      </p>
      <Link href="/harbor" className="dock-btn-primary" style={{ padding: '0.6rem 1.25rem' }}>
        Back to Harbor
      </Link>
    </div>
  )
}
