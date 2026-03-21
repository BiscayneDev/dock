'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface HarborShellProps {
  children: React.ReactNode
  title?: string
  showBack?: boolean
  backHref?: string
}

export function HarborShell({ children, title, showBack, backHref = '/harbor' }: HarborShellProps) {
  const [dateStr, setDateStr] = useState('')

  useEffect(() => {
    setDateStr(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  }, [])

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&family=Outfit:wght@400;500;700;800&display=swap" rel="stylesheet" />

      <style>{`
        :root {
          --cream: #EAE6D7;
          --ink: #102A22;
          --border-w: 1.5px;
          --radius-lg: 1.75rem;
          --radius-md: 1rem;
          --mesh-cyan: #5BA7CD;
          --mesh-yellow: #E8D368;
          --mesh-peach: #E48D6C;
          --mesh-mint: #94C4A3;
        }
        .harbor-shell { font-family: 'Lora', serif; color: var(--ink); -webkit-font-smoothing: antialiased; }
        .harbor-shell h1, .harbor-shell h2, .harbor-shell h3, .harbor-shell .font-sans {
          font-family: 'Outfit', sans-serif; color: var(--ink);
        }
        .harbor-shell .section-title {
          font-family: 'Outfit', sans-serif; font-size: 1.1rem; font-weight: 700;
          letter-spacing: -0.02em; margin-bottom: 0.75rem;
        }
        .harbor-shell .meta-text {
          font-family: 'Outfit', sans-serif; font-size: 0.65rem; text-transform: uppercase;
          letter-spacing: 0.05em; font-weight: 700; opacity: 0.7;
        }
        .dock-card {
          border: var(--border-w) solid var(--ink); border-radius: var(--radius-lg);
          background-color: var(--cream); padding: 1.25rem; position: relative;
          display: flex; flex-direction: column; text-decoration: none; color: var(--ink); overflow: hidden;
          transition: transform 0.1s;
        }
        .dock-card:active { transform: scale(0.98); }
        .dock-input {
          width: 100%; border: var(--border-w) solid var(--ink); border-radius: var(--radius-md);
          background-color: var(--cream); padding: 0.625rem 0.875rem; font-family: 'Lora', serif;
          font-size: 0.9rem; color: var(--ink); outline: none;
        }
        .dock-input:focus { box-shadow: 0 0 0 3px rgba(91, 167, 205, 0.2); }
        .dock-input::placeholder { color: var(--ink); opacity: 0.35; }
        .dock-btn-primary {
          border: var(--border-w) solid var(--ink); border-radius: 2rem;
          background-color: var(--ink); color: var(--cream); padding: 0.625rem 1.25rem;
          font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.85rem;
          cursor: pointer; transition: opacity 0.15s; text-align: center; text-decoration: none;
        }
        .dock-btn-primary:hover { opacity: 0.85; }
        .dock-btn-primary:disabled { opacity: 0.4; cursor: default; }
        .dock-btn-secondary {
          border: var(--border-w) solid var(--ink); border-radius: 2rem;
          background-color: var(--cream); color: var(--ink); padding: 0.625rem 1.25rem;
          font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.85rem;
          cursor: pointer; transition: background-color 0.15s; text-align: center; text-decoration: none;
        }
        .dock-btn-secondary:hover { background-color: #e0dccf; }
        .dock-toggle {
          width: 44px; height: 24px; border: var(--border-w) solid var(--ink); border-radius: 12px;
          position: relative; cursor: pointer; transition: background-color 0.2s;
        }
        .dock-toggle[data-on="true"] { background-color: var(--mesh-mint); }
        .dock-toggle[data-on="false"] { background-color: var(--cream); }
        .dock-toggle-knob {
          position: absolute; top: 2px; width: 18px; height: 18px; border-radius: 50%;
          border: var(--border-w) solid var(--ink); background: var(--cream);
          transition: transform 0.2s;
        }
        .badge-num {
          width: 24px; height: 24px; border: var(--border-w) solid var(--ink); border-radius: 50%;
          display: flex; justify-content: center; align-items: center;
          font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.75rem; flex-shrink: 0;
        }
        .card-gradient { background: linear-gradient(135deg, var(--mesh-peach) 0%, var(--mesh-yellow) 100%); }
        .card-cyan { background: linear-gradient(135deg, var(--mesh-cyan) 20%, var(--mesh-mint) 100%); }
      `}</style>

      <div className="harbor-shell" style={{ backgroundColor: '#d6dce8', minHeight: '100vh' }}>
        {/* Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.25rem 0.5rem', maxWidth: '42rem', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {showBack ? (
              <Link href={backHref} style={{
                width: '32px', height: '32px', border: '1.5px solid var(--ink)', borderRadius: '50%',
                display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--cream)',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </Link>
            ) : (
              <Link href="/harbor" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: 'var(--ink)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20h16M12 20v-8M7 8c2 0 5-3 5-3s3 3 5 3M12 5v3" />
                </svg>
              </Link>
            )}
            {title && (
              <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                {title}
              </h1>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: '0.85rem', opacity: 0.6 }}>{dateStr}</span>
            <Link href="/dashboard" style={{
              width: '32px', height: '32px', border: '1.5px solid var(--ink)', borderRadius: '50%',
              display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--cream)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
              </svg>
            </Link>
          </div>
        </header>

        {/* Content */}
        <div style={{ maxWidth: '42rem', margin: '0 auto', padding: '0.5rem 1.25rem 2.5rem' }}>
          {children}
        </div>
      </div>
    </>
  )
}
