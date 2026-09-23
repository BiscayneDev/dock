import Image from 'next/image'
import Link from 'next/link'
import styles from './CoastShell.module.css'

/**
 * Account surfaces (sign in, profile): Halsey's coast art full-bleed, a navy
 * wash for contrast, and one cream card. Same palette and type as the site.
 */
export function CoastShell({
  children,
  wide = false,
  right,
}: {
  children: React.ReactNode
  wide?: boolean
  /** top-right nav slot (e.g. sign out) */
  right?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.art} aria-hidden="true">
        <Image src="/hero-coast.jpg" alt="" fill priority sizes="100vw" quality={75} />
      </div>
      <nav className={styles.nav}>
        <Link href="/" className={styles.brand}>
          <Image src="/icon-192.png" alt="" width={30} height={30} />
          dinghy
        </Link>
        {right}
      </nav>
      <main className={styles.main}>
        <div className={`${styles.card} ${wide ? styles.wide : ''}`}>{children}</div>
      </main>
      <p className={styles.foot}><Link href="/">getdinghy.sh</Link> · <Link href="/privacy">privacy</Link></p>
    </div>
  )
}

export const shellStyles = styles
