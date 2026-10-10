import { NextRequest, NextResponse } from 'next/server'
import { processErasure } from '@/lib/data-portability/erase'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=120
export async function GET(request:NextRequest):Promise<NextResponse> {
  if(!process.env.CRON_SECRET || request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({error:'Unauthorized'},{status:401})
  try { return NextResponse.json({status:await processErasure()}) }
  catch { return NextResponse.json({error:'Queue unavailable'},{status:503}) }
}
