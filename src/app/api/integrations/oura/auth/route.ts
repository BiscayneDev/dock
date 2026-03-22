import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getOuraAuthUrl } from '@/lib/integrations/oura'

export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    return NextResponse.redirect(`${appUrl}/onboarding`)
  }

  return NextResponse.redirect(getOuraAuthUrl())
}
