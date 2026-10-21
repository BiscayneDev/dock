import { ImageResponse } from "next/og"

export const alt = "Dock — The open-source Agent OS for solo founders"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const runtime = "edge"

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0f",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Purple glow background */}
        <div
          style={{
            position: "absolute",
            top: "-200px",
            left: "50%",
            width: "800px",
            height: "800px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)",
            transform: "translateX(-50%)",
            display: "flex",
          }}
        />

        {/* Border glow */}
        <div
          style={{
            position: "absolute",
            inset: "2px",
            borderRadius: "0px",
            border: "1px solid rgba(124,58,237,0.3)",
            display: "flex",
          }}
        />

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            zIndex: 1,
          }}
        >
          {/* Anchor */}
          <div style={{ fontSize: 80, display: "flex" }}>⚓</div>

          {/* Title */}
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-2px",
              display: "flex",
            }}
          >
            Dock
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: 28,
              color: "#a1a1aa",
              display: "flex",
              marginTop: "-4px",
            }}
          >
            The open-source Agent OS for solo founders
          </div>

          {/* Agent emoji row */}
          <div
            style={{
              display: "flex",
              gap: "24px",
              marginTop: "32px",
              fontSize: 36,
            }}
          >
            <span style={{ display: "flex" }}>🦞</span>
            <span style={{ display: "flex" }}>🔭</span>
            <span style={{ display: "flex" }}>⚡</span>
            <span style={{ display: "flex" }}>🤝</span>
            <span style={{ display: "flex" }}>🏦</span>
          </div>

          {/* Agent labels */}
          <div
            style={{
              display: "flex",
              gap: "20px",
              fontSize: 14,
              color: "#71717a",
              marginTop: "-8px",
            }}
          >
            <span style={{ display: "flex", color: "#7c3aed" }}>Chief</span>
            <span style={{ display: "flex", color: "#06b6d4" }}>Scout</span>
            <span style={{ display: "flex", color: "#10b981" }}>Builder</span>
            <span style={{ display: "flex", color: "#f59e0b" }}>Deals</span>
            <span style={{ display: "flex", color: "#ec4899" }}>Baron</span>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            display: "flex",
            gap: "8px",
            alignItems: "center",
            color: "#52525b",
            fontSize: 16,
          }}
        >
          <span style={{ display: "flex" }}>github.com/BiscayneDev/dock</span>
        </div>
      </div>
    ),
    { ...size }
  )
}
