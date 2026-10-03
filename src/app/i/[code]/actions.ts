'use server'
import { redirect } from 'next/navigation'
import { claimInvite } from '@/lib/spectrum/invite-claim'

export async function claimSeat(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '')
  const result = await claimInvite(code, String(formData.get('phone') ?? ''), String(formData.get('name') ?? ''))
  if (result.ok) redirect(`/start/${encodeURIComponent(result.token)}`)
  redirect(`/i/${encodeURIComponent(code)}?e=${result.reason}`)
}
