import type { ImageResponse } from 'next/og'
import { renderOgCard } from '@/lib/brand/og-card'

export const runtime = 'nodejs'

export async function GET(): Promise<ImageResponse> {
  return renderOgCard({
    label: 'Dinghy',
    title: 'Your first mate,',
    accent: 'one text away',
    foot: 'getdinghy.sh',
  })
}
