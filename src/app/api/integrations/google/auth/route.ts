import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getAuthUrl } from '@/lib/integrations/google'

export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    return NextResponse.redirect(`${appUrl}/onboarding`)
  }

  const url = getAuthUrl([
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ])

  return NextResponse.redirect(url)
}
