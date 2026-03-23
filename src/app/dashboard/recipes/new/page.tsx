'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function RedirectToWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const idea = searchParams.get('idea')

  useEffect(() => {
    const url = idea
      ? `/dashboard/recipes/workspace?idea=${encodeURIComponent(idea)}`
      : '/dashboard/recipes/workspace'
    router.replace(url)
  }, [router, idea])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream, #EAE6D7)', fontFamily: "'Outfit', sans-serif", opacity: 0.5 }}>
      Redirecting to workspace...
    </div>
  )
}

export default function NewRecipePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--cream, #EAE6D7)' }} />}>
      <RedirectToWorkspace />
    </Suspense>
  )
}
