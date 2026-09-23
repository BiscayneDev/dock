import { Anchor, Sunrise } from './Scene'
import styles from './PaperPage.module.css'

/**
 * The paper surface: sunrise over water with a cream card rising over it.
 * Used for everything a user reaches by tapping something Dinghy sent them.
 */
export function PaperPage({
  label,
  title,
  accent,
  body,
  action,
  missing,
  fine,
  children,
}: {
  label: string
  /** lowercase headline; `accent` is appended in the italic accent */
  title: string
  accent?: string
  body: React.ReactNode
  action?: { href: string; label: string } | null
  /** shown instead of the action when the link is unusable */
  missing?: string
  fine?: React.ReactNode
  /** extra content under the body (e.g. a form) */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <main className={styles.page}>
      <div className={styles.band} aria-hidden="true">
        <Sunrise id="paper" sunX={900} boatX={300} horizon={430} />
      </div>
      <div className={styles.card}>
        <div className={styles.top}>
          <Anchor size={20} />
          <span className={styles.label}>{label}</span>
        </div>
        <h1 className={styles.title}>
          {title}
          {accent && <> <em>{accent}</em></>}
        </h1>
        <p className={styles.body}>{body}</p>
        {children}
        {action ? (
          <a className={styles.button} href={action.href}>{action.label}</a>
        ) : missing ? (
          <p className={styles.note}>{missing}</p>
        ) : null}
        {fine && <p className={styles.fine}>{fine}</p>}
      </div>
      <p className={styles.foot}><a href="https://www.getdinghy.sh">made by dinghy · getdinghy.sh</a></p>
    </main>
  )
}
