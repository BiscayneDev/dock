"use client"

import { useEffect, useRef, useState } from "react"

// Wave loop behind sign-in, settings pairing, and the desktop onboarding brief pane. Decorative only.
// - Reduced motion: the poster image is shown and the video is never mounted (no autoplay, no download).
// - Hidden tab: the video pauses and resumes when the tab is visible again.
// - A dark scrim sits on top: `center` is darkest in the middle (centred forms); `pane` is darkest along
//   the left edge where brief copy begins and lighter toward the outer right edge.
// Put content above it with `relative z-10`.

export const WAVE_VIDEO = "/onboarding-wave.mp4"
export const WAVE_POSTER = "/onboarding-wave-poster.jpg"

type Motion = "unknown" | "full" | "reduced"
export type WaveScrim = "center" | "pane"

const CENTER_SCRIM =
  "radial-gradient(ellipse 55% 65% at 50% 50%, rgba(5,5,7,0.94) 0%, rgba(5,5,7,0.86) 55%, rgba(5,5,7,0.6) 100%), " +
  "linear-gradient(to bottom, rgba(5,5,7,0.45) 0%, rgba(5,5,7,0.2) 40%, rgba(5,5,7,0.6) 100%)"

const PANE_SCRIM =
  "linear-gradient(to right, rgba(10,10,11,0.88) 0%, rgba(10,10,11,0.68) 45%, rgba(10,10,11,0.46) 78%, rgba(10,10,11,0.34) 100%), " +
  "linear-gradient(to bottom, rgba(10,10,11,0.36) 0%, rgba(10,10,11,0.08) 35%, rgba(10,10,11,0.12) 70%, rgba(10,10,11,0.42) 100%)"

// `contained` keeps the loop inside the nearest positioned parent (for example a settings panel or
// the desktop brief pane) instead of covering the viewport. The parent must be `relative overflow-hidden`.
export function WaveBackground({
  contained = false,
  scrim = "center",
}: {
  contained?: boolean
  scrim?: WaveScrim
} = {}) {
  const [motion, setMotion] = useState<Motion>("unknown")
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setMotion(mq.matches ? "reduced" : "full")
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  useEffect(() => {
    if (motion !== "full") return
    const onVisibility = () => {
      const v = videoRef.current
      if (!v) return
      if (document.hidden) v.pause()
      else void v.play().catch(() => null)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [motion])

  return (
    <div
      aria-hidden
      data-wave-bg={scrim}
      className={`pointer-events-none ${contained ? "absolute" : "fixed"} inset-0 z-0 overflow-hidden`}
      style={{ background: scrim === "pane" ? "var(--ob-bg, var(--surface-0))" : "var(--surface-0)" }}
    >
      {motion === "full" ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={WAVE_VIDEO}
          poster={WAVE_POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      ) : (
        // Poster until motion preference is known, and for reduced motion throughout.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="absolute inset-0 h-full w-full object-cover" src={WAVE_POSTER} alt="" />
      )}
      <div
        className="absolute inset-0"
        style={{ background: scrim === "pane" ? PANE_SCRIM : CENTER_SCRIM }}
      />
    </div>
  )
}
