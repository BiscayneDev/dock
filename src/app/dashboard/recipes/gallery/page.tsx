'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface Template {
  slug: string; name: string; description: string; category: string
  requiredIntegrations: string[]; triggerType: string; previewOutput: string; icon: string
}

type FilterTab = 'all' | 'automate' | 'integrate'

const INTEGRATION_LABELS: Record<string, string> = { google: 'Google', github: 'GitHub', notion: 'Notion', openwallet: 'Wallet' }

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
      if (res.ok) { const data = await res.json(); setTemplates(data.templates ?? []) }
    } catch { /* Failed */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const installTemplate = async (slug: string) => {
    setInstalling(slug)
    try {
      const res = await fetch(`/api/recipe-templates/${slug}/install`, { method: 'POST', credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        router.push(data.needsConfig ? data.editUrl : `/dashboard/recipes/${data.recipe.id}`)
      }
    } catch { /* Failed */ } finally { setInstalling(null) }
  }

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
    <HarborShell title="Recipe Gallery" showBack backHref="/dashboard/recipes">
      {/* Heading */}
      <p className="text-slate-500 text-[15px] mt-1 mb-5">Pre-built automations. Install in one tap.</p>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {([['all', 'All'], ['automate', 'Scheduled'], ['integrate', 'Triggered']] as [FilterTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setFilter(key); setActiveCategory(null) }}
            className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              filter === key ? 'bg-slate-800 text-white' : 'bg-white/40 text-slate-500 hover:bg-white/60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-blue-100/60 text-blue-600 border border-blue-200/60'
                : 'bg-white/40 text-slate-400 border border-white/50 hover:bg-white/60'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-3 grid-cols-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="glass-card rounded-[20px] h-44 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card rounded-[24px] p-10 text-center">
          <p className="text-slate-400">No recipes match this filter.</p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2">
          {filtered.map((tmpl) => (
            <div key={tmpl.slug} className="glass-card rounded-[20px] p-4 flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <span className="text-2xl">{tmpl.icon}</span>
                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide bg-white/40 px-1.5 py-0.5 rounded-full">
                  {tmpl.category}
                </span>
              </div>
              <p className="font-medium text-slate-700 text-[14px] leading-tight">{tmpl.name}</p>
              <p className="text-[12px] text-slate-400 mt-1 flex-1 line-clamp-2">{tmpl.description}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {tmpl.requiredIntegrations.map((int) => (
                  <span key={int} className="text-[10px] text-slate-400 bg-white/40 px-1.5 py-0.5 rounded-full">
                    {INTEGRATION_LABELS[int] ?? int}
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5 mt-3">
                <button
                  onClick={() => installTemplate(tmpl.slug)}
                  disabled={installing === tmpl.slug}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-white text-[12px] font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {installing === tmpl.slug ? '...' : 'Add'}
                </button>
                <button
                  onClick={() => setPreviewSlug(previewSlug === tmpl.slug ? null : tmpl.slug)}
                  className="py-2 px-3 rounded-xl bg-white/50 border border-white/70 text-[12px] text-slate-500 hover:bg-white/70 transition-colors"
                >
                  <i className="ph ph-eye text-[14px]" />
                </button>
              </div>
              {previewSlug === tmpl.slug && (
                <div className="mt-2 p-3 rounded-xl bg-white/60 border border-white/70">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Preview</p>
                  <pre className="text-[11px] text-slate-600 whitespace-pre-wrap" style={{ fontFamily: "'Inter', sans-serif" }}>
                    {tmpl.previewOutput}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bottom CTA */}
      <div className="mt-8 text-center">
        <p className="text-[13px] text-slate-400 mb-2">Looking for something else?</p>
        <button
          onClick={() => router.push('/dashboard/recipes/new')}
          className="px-5 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500 hover:bg-white/70 transition-colors"
        >
          Create your own
        </button>
      </div>
    </HarborShell>
  )
}
