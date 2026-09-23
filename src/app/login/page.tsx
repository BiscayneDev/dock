import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { CoastShell } from '@/components/brand/CoastShell'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = {
  title: 'Sign in · Dinghy',
  description: 'Sign in to your Dinghy profile.',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>
}): Promise<React.JSX.Element> {
  const sp = await searchParams
  if (await getSession()) {
    redirect(sp.connected ? `/profile?connected=${encodeURIComponent(sp.connected)}` : '/profile')
  }
  const notice = sp.error
    ? sp.error.startsWith('connect_')
      ? 'That connect link didn\u2019t work or expired. Ask Dinghy for a fresh one, or sign in to connect from your profile.'
      : 'Please sign in to continue.'
    : null
  return (
    <CoastShell>
      <LoginForm notice={notice} />
    </CoastShell>
  )
}
