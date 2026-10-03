'use client'

import { useEffect, useState } from 'react'
import styles from '../start.module.css'

interface Look { status: string; title: string; body: string; done: boolean }

export default function FirstLookCard({ token, initial }: { token: string; initial: Look }) {
  const [look, setLook] = useState<Look>(initial)
  useEffect(() => {
    if (look.done) return
    let stop = false
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/start/${encodeURIComponent(token)}/status`, { cache: 'no-store' })
        if (res.ok) { const next = (await res.json()) as Look; if (!stop) setLook(next) }
      } catch { /* keep polling */ }
    }
    const id = setInterval(poll, 3000)
    return () => { stop = true; clearInterval(id) }
  }, [token, look.done])
  return (
    <div className={styles.card} aria-live="polite">
      <div className={look.done ? styles.dotDone : styles.dotWorking} aria-hidden="true" />
      <div><strong>{look.title}</strong><br />{look.body}</div>
    </div>
  )
}
