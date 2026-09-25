'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Admin surfaces — same family as CoastShell/PaperPage: Halsey's coast art
 * full-bleed under a navy wash, cream cards, Fraunces wordmark. Replaces the
 * retired Telegram-Dock Harbor look for admin-only pages. Keeps the legacy
 * class names (dock-card, dock-btn-*, meta-text, section-title) so page
 * content ports over unchanged, restyled to the current palette.
 */
export function AdminShell({
  children,
  title,
  showBack,
  backHref = '/',
}: {
  children: React.ReactNode
  title?: string
  showBack?: boolean
  backHref?: string
}) {
  const [dateStr, setDateStr] = useState('')
  useEffect(() => {
    setDateStr(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  }, [])

  return (
    <>
      <style>{`
        .admin-shell {
          --ink: #0E1A33;
          --cream: #FBF6EE;
          --cream-dim: #F1EADB;
          --border-w: 1.5px;
          --radius-lg: 24px;
          --radius-md: 1rem;
          --mesh-cyan: #3E6FA8;
          --mesh-yellow: #C9A227;
          --mesh-peach: #C05B3C;
          --mesh-mint: #3E7A5C;
          position: relative; min-height: 100svh; overflow-x: hidden;
          font-family: var(--font-schibsted), -apple-system, Helvetica, Arial, sans-serif;
          color: var(--ink); -webkit-font-smoothing: antialiased;
        }
        .admin-shell .admin-art { position: fixed; inset: 0; z-index: 0; }
        .admin-shell .admin-art img { object-fit: cover; object-position: 58% 60%; }
        .admin-shell .admin-art::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(to bottom, rgba(14, 26, 51, 0.6) 0%, rgba(14, 26, 51, 0.25) 40%, rgba(14, 26, 51, 0.4) 100%);
        }
        .admin-shell h1, .admin-shell h2, .admin-shell h3 { font-family: var(--font-schibsted), sans-serif; color: var(--ink); }
        .admin-shell .font-serif-brand { font-family: var(--font-fraunces), Georgia, serif; }
        .admin-shell .section-title {
          font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em;
          margin-bottom: 0.75rem; font-family: var(--font-schibsted), sans-serif;
        }
        .admin-shell .meta-text {
          font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em;
          font-weight: 700; opacity: 0.6; font-family: var(--font-schibsted), sans-serif;
        }
        .admin-shell .dock-card {
          border: var(--border-w) solid var(--ink); border-radius: var(--radius-lg);
          background-color: var(--cream); padding: 1.25rem; position: relative;
          display: flex; flex-direction: column; text-decoration: none; color: var(--ink);
          overflow: hidden; transition: transform 0.1s;
          box-shadow: 0 20px 50px rgba(6, 11, 26, 0.25);
        }
        .admin-shell .dock-card:active { transform: scale(0.98); }
        .admin-shell .dock-input {
          width: 100%; border: var(--border-w) solid var(--ink); border-radius: var(--radius-md);
          background-color: var(--cream); padding: 0.625rem 0.875rem;
          font-size: 0.9rem; color: var(--ink); outline: none;
        }
        .admin-shell .dock-btn-primary {
          border: var(--border-w) solid var(--ink); border-radius: 2rem;
          background-color: var(--ink); color: var(--cream); padding: 0.625rem 1.25rem;
          font-weight: 700; font-size: 0.85rem; cursor: pointer;
          transition: opacity 0.15s; text-align: center; text-decoration: none;
        }
        .admin-shell .dock-btn-primary:hover { opacity: 0.85; }
        .admin-shell .dock-btn-primary:disabled { opacity: 0.4; cursor: default; }
        .admin-shell .dock-btn-secondary {
          border: var(--border-w) solid var(--ink); border-radius: 2rem;
          background-color: var(--cream); color: var(--ink); padding: 0.625rem 1.25rem;
          font-weight: 700; font-size: 0.85rem; cursor: pointer;
          transition: background-color 0.15s; text-align: center; text-decoration: none;
        }
        .admin-shell .dock-btn-secondary:hover { background-color: var(--cream-dim); }
        .admin-shell .badge-num {
          width: 24px; height: 24px; border: var(--border-w) solid var(--ink); border-radius: 50%;
          display: flex; justify-content: center; align-items: center;
          font-weight: 700; font-size: 0.75rem; flex-shrink: 0;
        }
      `}</style>

      <div className="admin-shell">
        <div className="admin-art" aria-hidden="true">
          <Image src="/hero-coast.jpg" alt="" fill priority sizes="100vw" quality={75} />
        </div>

        <header style={{ position: 'relative', zIndex: 1, maxWidth: '56rem', margin: '0 auto', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 1.5rem 0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {showBack ? (
              <Link href={backHref} style={{
                width: '32px', height: '32px', border: '1.5px solid var(--cream)', borderRadius: '50%',
                display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--cream)',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </Link>
            ) : null}
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: '#FBF6EE' }}>
              <Image src="/icon-192.png" alt="" width={30} height={30} style={{ borderRadius: 8 }} />
              <span style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontVariationSettings: "'SOFT' 100", fontWeight: 520, fontSize: 22, letterSpacing: '-0.01em' }}>dinghy</span>
            </Link>
            {title && (
              <span style={{ color: 'rgba(251, 246, 238, 0.6)', fontSize: '0.85rem' }}>· {title}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ color: 'rgba(251, 246, 238, 0.6)', fontSize: '0.85rem' }}>{dateStr}</span>
          </div>
        </header>

        <div style={{ position: 'relative', zIndex: 1, maxWidth: '56rem', margin: '0 auto', padding: '1rem 1.5rem 3rem', width: '100%' }}>
          {children}
        </div>
      </div>
    </>
  )
}
