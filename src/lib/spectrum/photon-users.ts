/**
 * Photon (Spectrum Cloud) project users.
 *
 * On the Free/Pro shared pool only registered project users can talk to Dinghy,
 * and each one is assigned their own iMessage number. Registering is idempotent
 * on phoneNumber: re-creating returns the same user and number.
 * Docs: https://photon.codes/docs/api-reference/users/create-user
 */

const SPECTRUM_CLOUD_URL = 'https://spectrum.photon.codes'

export interface PhotonUser {
  id: string
  phoneNumber: string
  assignedPhoneNumber: string
}

function creds(): { projectId: string; projectSecret: string } | null {
  const projectId = process.env.SPECTRUM_PROJECT_ID
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET
  return projectId && projectSecret ? { projectId, projectSecret } : null
}

/** Register (or look up) a shared-pool user. Returns null on any failure. */
export async function registerPhotonUser(phone: string, name?: string | null): Promise<PhotonUser | null> {
  const c = creds()
  if (!c) return null
  const [firstName, ...rest] = (name ?? '').trim().split(/\s+/).filter(Boolean)
  const body: Record<string, string> = { type: 'shared', phoneNumber: phone }
  if (firstName) body.firstName = firstName.slice(0, 80)
  if (rest.length) body.lastName = rest.join(' ').slice(0, 80)
  try {
    const res = await fetch(`${SPECTRUM_CLOUD_URL}/projects/${c.projectId}/users/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${c.projectId}:${c.projectSecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null) as { succeed?: boolean; data?: Partial<PhotonUser>; message?: string } | null
    if (!res.ok || !json?.succeed || !json.data?.id || !json.data.assignedPhoneNumber) {
      console.error('Photon user create failed:', res.status, json?.message ?? '')
      return null
    }
    return { id: json.data.id, phoneNumber: json.data.phoneNumber ?? phone, assignedPhoneNumber: json.data.assignedPhoneNumber }
  } catch (err) {
    console.error('Photon user create error:', err instanceof Error ? err.message : 'unknown')
    return null
  }
}

/** "+16282647754" -> "(628) 264-7754"; non-US numbers come back unchanged. */
export function prettyPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}
