import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { sameOrigin } from '@/lib/auth/same-origin'
import { erasureEnabled } from '@/lib/data-portability/erasure-state'
import { confirmErase, requestErase, ERASE_WARNING } from '@/lib/data-portability/erase'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!erasureEnabled()) return NextResponse.json({error:'Data deletion is not enabled'}, {status:404})
  if (!sameOrigin(request)) return NextResponse.json({error:'Forbidden'}, {status:403})
  const session=await getSession()
  if (!session) return NextResponse.json({error:'Sign in first'}, {status:401})
  try {
    const body=await request.json()
    if (body.action==='request') {
      const gate=await requestErase(session.userId)
      return NextResponse.json({...gate,warning:ERASE_WARNING,confirmation:'DELETE MY DATA',expiresInSeconds:600}, {headers:{'Cache-Control':'no-store'}})
    }
    if (body.action==='confirm' && typeof body.id==='string' && typeof body.token==='string' && typeof body.phrase==='string') {
      const ok=await confirmErase(session.userId,body.id,body.token,body.phrase)
      return NextResponse.json(ok ? {status:'queued',message:'Deletion queued. Access is frozen; this is not a completion receipt.'} : {error:'Confirmation expired or invalid'}, {status:ok?202:400,headers:{'Cache-Control':'no-store'}})
    }
    return NextResponse.json({error:'Invalid request'}, {status:400})
  } catch { return NextResponse.json({error:'Could not process deletion. Check status before retrying.'}, {status:503}) }
}
export async function GET(request:NextRequest): Promise<NextResponse> {
  if (!erasureEnabled()) return NextResponse.json({error:'Data deletion is not enabled'}, {status:404})
  const {createServerClient}=await import('@/lib/supabase/server')
  const db=createServerClient()
  const receipt=request.headers.get('x-erasure-receipt')
  const id=request.nextUrl.searchParams.get('id')
  if(receipt && id && /^[A-Za-z0-9_-]{43}$/.test(receipt) && /^[0-9a-f-]{36}$/i.test(id)) {
    const {hashEraseToken}=await import('@/lib/data-portability/erase')
    const {data,error}=await db.from('dinghy_erasure_jobs').select('status,obstacle,provider_notes,requested_at,completed_at')
      .eq('id',id).eq('confirm_hash',hashEraseToken(receipt)).neq('status','confirm').maybeSingle()
    if(error) return NextResponse.json({error:'Status unavailable'},{status:503})
    if(!data) return NextResponse.json({error:'Receipt unavailable or expired'},{status:404})
    return NextResponse.json({job:data},{headers:{'Cache-Control':'no-store'}})
  }
  const session=await getSession()
  if (!session) return NextResponse.json({error:'Sign in first'}, {status:401})
  const {data,error}=await db.from('dinghy_erasure_jobs').select('status,obstacle,provider_notes,requested_at,completed_at').eq('user_id',session.userId).order('requested_at',{ascending:false}).limit(1).maybeSingle()
  if(error) return NextResponse.json({error:'Status unavailable'},{status:503})
  return NextResponse.json({job:data,warning:ERASE_WARNING},{headers:{'Cache-Control':'no-store'}})
}
