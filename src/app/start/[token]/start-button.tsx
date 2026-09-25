import styles from './start.module.css'

export default function StartButton({ href, label }: { href: string; label: string }) {
  return <a className={styles.button} href={href}>{label} <span aria-hidden="true">→</span></a>
}
