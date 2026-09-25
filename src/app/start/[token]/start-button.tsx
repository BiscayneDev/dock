'use client'

import { useEffect } from 'react'
import styles from './start.module.css'

export default function StartButton({ href }: { href: string }) {
  // A top-level HTTPS page escapes email-client links; a real tap remains
  // available when its embedded browser blocks automatic sms: navigation.
  useEffect(() => { window.location.href = href }, [href])
  return <a className={styles.button} href={href}>Open Messages <span aria-hidden="true">→</span></a>
}
