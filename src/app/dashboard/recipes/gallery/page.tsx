'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/NavBar'

interface Template {
  slug: string
  name: string
  description: string
  category: string
  requiredIntegrations: string[]
  triggerType: string
  previewOutput: string
}

const CATEGORY_ORDER = ['Productivity', 'Email', 'Calendar', 'GitHub', 'Notion']

const INTEGRATION_BADGES: Record<string, string> = {
  google: '📧 Google',
  github: '🐙 GitHub',
  notion: '📝 Notion',
}

export default function GalleryPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/recipe-templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates ?? [])
      }
    } catch {
      // Failed
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const installTemplate = async (slug: string) => {
    setInstalling(slug)
    try {
      const res = await fetch(`/api/recipe-templates/${slug}/install`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        if (data.needsConfig) {
          router.push(data.editUrl)
        } else {
          router.push(`/dashboard/recipes/${data.recipe.id}`)
        }
      }
    } catch {
      // Failed
    } finally {
      setInstalling(null)
    }
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    templates: templates.filter((t) => t.category === cat),
  })).filter((g) => g.templates.length > 0)

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-100 mb-6">Recipe Gallery</h1>

        {loading ? (
          <p className="text-zinc-400">Loading templates...</p>
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <section key={group.category}>
                <h2 className="text-lg font-semibold text-zinc-200 mb-3">{group.category}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.templates.map((tmpl) => (
                    <div
                      key={tmpl.slug}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                    >
                      <h3 className="font-medium text-zinc-100">{tmpl.name}</h3>
                      <p className="mt-1 text-sm text-zinc-400">{tmpl.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tmpl.requiredIntegrations.map((int) => (
                          <span
                            key={int}
                            className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                          >
                            {INTEGRATION_BADGES[int] ?? int}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => installTemplate(tmpl.slug)}
                        disabled={installing === tmpl.slug}
                        className="mt-3 rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors disabled:opacity-50"
                      >
                        {installing === tmpl.slug ? 'Installing...' : 'Add to Dock'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
