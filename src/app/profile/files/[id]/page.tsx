import { redirect, notFound } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { getFile, fileLinkState, safeFileUrl } from '@/lib/profile/files'
import { CoastShell } from '@/components/brand/CoastShell'
import styles from '../../profile.module.css'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your file · Dinghy', robots: { index: false, follow: false } }
export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params
  const file = await getFile(session.userId, id)
  if (!file || file.revoked_at) notFound()
  const state = fileLinkState(file)
  return <CoastShell wide><a href="/profile" className={styles.back}>← Your Dinghy</a>
    <h1 className={styles.title}>{file.title}</h1>
    <p className={styles.meta}>Private saved copy · {new Date(file.created_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}</p>
    {state === 'live' && <a className={styles.connect} href={safeFileUrl(file.url)!} target="_blank" rel="noopener noreferrer">Open on here.now</a>}
    {state === 'expired' && <p className={styles.meta}>The shared link has expired. Your saved copy is still here.</p>}
    <pre className={styles.savedBody}>{file.markdown}</pre>
  </CoastShell>
}
