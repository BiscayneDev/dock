import type { ImageResponse } from 'next/og'
import { renderOgCard } from '@/lib/brand/og-card'

export const runtime = 'nodejs'

export async function GET(): Promise<ImageResponse> {
  return renderOgCard({
    label: 'dinghy',
    title: 'your first mate lives in',
    accent: 'your texts',
    foot: 'getdinghy.sh',
  })
}
