import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

// List user's payment history (sent + received)
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 50)
  const offset = Number(searchParams.get('offset') ?? '0')
  const direction = searchParams.get('direction') // 'sent' | 'received' | null (both)

  const supabase = createServerClient()

  let query = supabase
    .from('recipe_payments')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (direction === 'sent') {
    query = query.eq('payer_id', session.userId)
  } else if (direction === 'received') {
    query = query.eq('recipient_id', session.userId)
  } else {
    query = query.or(`payer_id.eq.${session.userId},recipient_id.eq.${session.userId}`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }

  return NextResponse.json({ payments: data ?? [] })
}
