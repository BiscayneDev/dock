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
    setDateStr(new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }))
  }, [])

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Inter:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <script src="https://unpkg.com/@phosphor-icons/web" async />

      <style>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.45);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.6);
          box-shadow: 0 4px 24px -6px rgba(0, 0, 0, 0.03), inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        }
        .glass-card-hover:hover {
          background: rgba(255, 255, 255, 0.55);
        }
        .glass-card-hover:active {
          transform: scale(0.98);
        }
        .glass-input {
          background: rgba(255, 255, 255, 0.5);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.7);
        }
        .glass-input:focus {
          background: rgba(255, 255, 255, 0.7);
          outline: none;
          border-color: rgba(100, 149, 237, 0.5);
          box-shadow: 0 0 0 3px rgba(100, 149, 237, 0.1);
        }
      `}</style>

      <div
        className="min-h-screen bg-gradient-to-b from-[#dce4f0] via-[#c8d6e5] to-[#b8cce0] text-slate-800"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        {/* Header */}
        <header className="flex justify-between items-center px-5 pt-6 pb-2 max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            {showBack ? (
              <Link
                href={backHref}
                className="w-9 h-9 rounded-full bg-white/50 backdrop-blur-sm border border-white/70 flex items-center justify-center text-slate-500 hover:bg-white/70 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </Link>
            ) : (
              <Link href="/harbor" className="text-slate-700 hover:text-slate-900 transition-colors">
                <i className="ph-fill ph-anchor text-[24px]" />
              </Link>
            )}
            {title && (
              <h1
                className="text-[22px] text-slate-800 tracking-tight"
                style={{ fontFamily: "'Newsreader', serif" }}
              >
                {title}
              </h1>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium text-slate-400">{dateStr}</span>
            <Link
              href="/dashboard"
              className="w-9 h-9 rounded-full bg-white/50 backdrop-blur-sm border border-white/70 flex items-center justify-center text-slate-400 hover:bg-white/70 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
          </div>
        </header>

        {/* Content */}
        <div className="max-w-2xl mx-auto px-5 pb-10">
          {children}
        </div>
      </div>
    </>
  )
}
