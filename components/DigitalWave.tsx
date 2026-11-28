"use client"

import { useRef, useState, useSyncExternalStore } from "react"

const motionQuery = "(prefers-reduced-motion: no-preference)"
const poster = "/shipyard-waves-poster.jpg"

function subscribe(callback: () => void) {
  const query = window.matchMedia(motionQuery)
  query.addEventListener("change", callback)
  return () => query.removeEventListener("change", callback)
}

export function DigitalWave({ className }: { className: string }) {
  const allowMotion = useSyncExternalStore(subscribe, () => window.matchMedia(motionQuery).matches, () => false)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  return (
    <div className={`dock-wave-media ${className}`}>
      {allowMotion ? (
        <video ref={video} src="/shipyard-waves.mp4" poster={poster} autoPlay muted loop playsInline
          aria-hidden="true" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" width={960} height={540} />
      )}
      {allowMotion && (
        <button type="button" className="dock-wave-toggle" onClick={() => {
          const element = video.current
          if (!element) return
          if (element.paused) void element.play().catch(() => {})
          else element.pause()
        }}>{playing ? "Pause wave" : "Play wave"}</button>
      )}
    </div>
  )
}
