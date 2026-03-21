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
  icon: string
}

type FilterTab = 'all' | 'automate' | 'integrate'

const INTEGRATION_ICONS: Record<string, { icon: string; label: string }> = {
  google: { icon: '📧', label: 'Google' },
  github: { icon: '🐙', label: 'GitHub' },
  notion: { icon: '📝', label: 'Notion' },
  openwallet: { icon: '🔐', label: 'Wallet' },
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Scheduled',
  email_event: 'Email trigger',
  github_event: 'GitHub trigger',
  notion_event: 'Notion trigger',
  keyword: 'Keyword trigger',
  manual: 'Manual',
}

export default function GalleryPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [previewSlug, setPreviewSlug] = useState<string | null>(null)

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

  // Filter logic
  const scheduleTypes = new Set(['schedule'])
  const eventTypes = new Set(['email_event', 'github_event', 'notion_event', 'keyword'])

  const filtered = templates.filter((t) => {
    if (filter === 'automate' && !scheduleTypes.has(t.triggerType)) return false
    if (filter === 'integrate' && !eventTypes.has(t.triggerType)) return false
    if (activeCategory && t.category !== activeCategory) return false
    return true
  })

  const categories = [...new Set(templates.map((t) => t.category))]

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-zinc-100 tracking-tight">
            Set up in one tap
          </h1>
          <p className="mt-3 text-lg text-zinc-400 max-w-lg mx-auto">
            Pre-built automations to make your life easier. Install instantly or create your own.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => router.push('/dashboard/recipes/new')}
              className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
            >
              Create my own
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center justify-center gap-1 mb-6">
          {([
            ['all', 'All'],
            ['automate', 'Automate'],
            ['integrate', 'Integrate'],
          ] as [FilterTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setFilter(key); setActiveCategory(null) }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === key
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Category tags */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? 'border-cyan-500 bg-cyan-950/40 text-cyan-400'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Template grid */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 rounded-2xl border border-zinc-800 bg-zinc-900/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-500">No recipes match this filter.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((tmpl) => (
              <div
                key={tmpl.slug}
                className="group relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-600 transition-all hover:shadow-lg hover:shadow-black/20"
              >
                {/* Icon + category badge */}
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl">{tmpl.icon}</span>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400 uppercase tracking-wide">
                    {tmpl.category}
                  </span>
                </div>

                {/* Title + description */}
                <h3 className="font-semibold text-zinc-100 text-base">{tmpl.name}</h3>
                <p className="mt-1 text-sm text-zinc-400 line-clamp-2">{tmpl.description}</p>

                {/* Trigger type */}
                <p className="mt-2 text-xs text-zinc-500">
                  {TRIGGER_LABELS[tmpl.triggerType] ?? tmpl.triggerType}
                </p>

                {/* Integration badges */}
                <div className="mt-3 flex items-center gap-1.5">
                  {tmpl.requiredIntegrations.map((int) => {
                    const meta = INTEGRATION_ICONS[int]
                    return (
                      <span
                        key={int}
                        className="inline-flex items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300"
                      >
                        {meta?.icon ?? '🔌'} {meta?.label ?? int}
                      </span>
                    )
                  })}
                </div>

                {/* Actions */}
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => installTemplate(tmpl.slug)}
                    disabled={installing === tmpl.slug}
                    className="flex-1 rounded-xl bg-cyan-600 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-colors disabled:opacity-50"
                  >
                    {installing === tmpl.slug ? 'Installing...' : 'Add to Dock'}
                  </button>
                  <button
                    onClick={() => setPreviewSlug(previewSlug === tmpl.slug ? null : tmpl.slug)}
                    className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
                  >
                    Preview
                  </button>
                </div>

                {/* Preview output (expandable) */}
                {previewSlug === tmpl.slug && (
                  <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-950 p-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Example output</p>
                    <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
                      {tmpl.previewOutput}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Bottom CTA */}
        <div className="mt-12 text-center border-t border-zinc-800 pt-8">
          <p className="text-zinc-400">Looking for something else?</p>
          <button
            onClick={() => router.push('/dashboard/recipes/new')}
            className="mt-3 rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:border-zinc-500 transition-colors"
          >
            Create your own recipe
          </button>
        </div>
      </main>
    </>
  )
}
