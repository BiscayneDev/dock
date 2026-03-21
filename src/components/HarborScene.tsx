export function HarborScene() {
  return (
    <svg
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      aria-label="Harbor scene illustration"
    >
      {/* Sky gradient */}
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#e0f2fe" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.3" />
          <stop offset="60%" stopColor="#22d3ee" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#a5f3fc" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="cliff" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#64748b" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="lighthouse" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect width="400" height="280" fill="url(#sky)" />

      {/* Sun glow */}
      <circle cx="320" cy="60" r="50" fill="url(#sun)" />
      <circle cx="320" cy="60" r="18" fill="#fde68a" opacity="0.5" />

      {/* Distant hills/cliffs */}
      <path
        d="M0 180 Q30 120 80 140 Q120 100 160 130 Q200 110 240 140 Q260 130 280 145 L280 200 L0 200Z"
        fill="url(#cliff)"
      />

      {/* Water */}
      <rect x="0" y="170" width="400" height="110" fill="url(#water)" />

      {/* Water ripples */}
      <path d="M0 190 Q50 186 100 190 Q150 194 200 190 Q250 186 300 190 Q350 194 400 190" stroke="#22d3ee" strokeOpacity="0.15" strokeWidth="1" fill="none" />
      <path d="M0 210 Q60 206 120 210 Q180 214 240 210 Q300 206 360 210 Q380 212 400 210" stroke="#22d3ee" strokeOpacity="0.1" strokeWidth="1" fill="none" />
      <path d="M0 230 Q40 227 80 230 Q140 233 200 230 Q260 227 320 230 Q360 233 400 230" stroke="#22d3ee" strokeOpacity="0.08" strokeWidth="1" fill="none" />

      {/* Lighthouse */}
      <rect x="290" y="115" width="18" height="55" rx="2" fill="url(#lighthouse)" />
      <rect x="286" y="112" width="26" height="8" rx="2" fill="#e2e8f0" opacity="0.8" />
      <rect x="293" y="100" width="12" height="14" rx="1" fill="#bae6fd" opacity="0.6" />
      {/* Lighthouse stripes */}
      <rect x="290" y="130" width="18" height="6" fill="#f87171" opacity="0.4" />
      <rect x="290" y="148" width="18" height="6" fill="#f87171" opacity="0.4" />
      {/* Lighthouse light */}
      <circle cx="299" cy="107" r="3" fill="#fde68a" opacity="0.7" />

      {/* Dock/pier */}
      <rect x="240" y="165" width="80" height="5" rx="1" fill="#a8a29e" opacity="0.4" />
      {/* Pier posts */}
      <rect x="250" y="165" width="3" height="20" fill="#a8a29e" opacity="0.3" />
      <rect x="270" y="165" width="3" height="20" fill="#a8a29e" opacity="0.3" />
      <rect x="290" y="165" width="3" height="20" fill="#a8a29e" opacity="0.3" />
      <rect x="310" y="165" width="3" height="20" fill="#a8a29e" opacity="0.3" />

      {/* Sailboat */}
      <g transform="translate(160, 140)">
        {/* Hull */}
        <path d="M0 30 Q5 40 25 40 Q45 40 50 30 Z" fill="#94a3b8" opacity="0.4" />
        {/* Mast */}
        <line x1="25" y1="0" x2="25" y2="30" stroke="#94a3b8" strokeWidth="1.5" opacity="0.5" />
        {/* Sail */}
        <path d="M25 2 L25 28 L42 25 Z" fill="#bae6fd" opacity="0.35" />
        <path d="M25 5 L25 28 L12 26 Z" fill="#e0f2fe" opacity="0.3" />
      </g>

      {/* Small boat near dock */}
      <g transform="translate(260, 172)">
        <path d="M0 8 Q2 14 10 14 Q18 14 20 8 Z" fill="#a8a29e" opacity="0.35" />
        <line x1="10" y1="0" x2="10" y2="8" stroke="#a8a29e" strokeWidth="1" opacity="0.4" />
      </g>

      {/* Birds */}
      <path d="M100 50 Q105 45 110 50" stroke="#94a3b8" strokeWidth="1" fill="none" opacity="0.3" />
      <path d="M120 40 Q124 36 128 40" stroke="#94a3b8" strokeWidth="1" fill="none" opacity="0.25" />
      <path d="M85 60 Q88 57 91 60" stroke="#94a3b8" strokeWidth="0.8" fill="none" opacity="0.2" />

      {/* Anchor icon (subtle, in the water) */}
      <g transform="translate(50, 200)" opacity="0.12">
        <circle cx="15" cy="5" r="4" stroke="#0e7490" strokeWidth="1.5" fill="none" />
        <line x1="15" y1="9" x2="15" y2="30" stroke="#0e7490" strokeWidth="1.5" />
        <path d="M5 22 Q15 35 25 22" stroke="#0e7490" strokeWidth="1.5" fill="none" />
        <line x1="12" y1="15" x2="18" y2="15" stroke="#0e7490" strokeWidth="1.5" />
      </g>
    </svg>
  )
}
