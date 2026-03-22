'use client'

import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface X402Service { name: string; description: string; price: number | null; category: string | null; recipe_idea: string }
interface ToolCallEntry { name: string; input: unknown; result: unknown }
interface ParsedRecipe { name: string; trigger_type: string; trigger_config: Record<string, unknown>; instructions: string; category: string }
interface Message { role: 'user' | 'agent'; content: string; toolCalls?: ToolCallEntry[]; recipe?: ParsedRecipe }

const SKILLS = [
  { group: 'Email', items: [{ name: 'Search emails', prompt: 'search my recent emails for...' }, { name: 'Summarize inbox', prompt: 'summarize my unread emails from the last few hours' }, { name: 'Draft email', prompt: 'draft an email to...' }] },
  { group: 'Calendar', items: [{ name: "Today's schedule", prompt: "what's on my calendar today?" }, { name: 'Find free time', prompt: 'find free time on my calendar this week' }, { name: 'Create event', prompt: 'schedule a meeting for...' }] },
  { group: 'GitHub', items: [{ name: 'Open PRs', prompt: 'show me open pull requests' }, { name: 'My issues', prompt: 'list issues assigned to me' }, { name: 'Notifications', prompt: 'check my github notifications' }] },
  { group: 'Web & x402', items: [{ name: 'Search the web', prompt: 'search the web for...' }, { name: 'Browse x402 APIs', prompt: 'show me x402 services I can use' }, { name: 'Fetch a page', prompt: 'read the page at...' }] },
  { group: 'Wallet', items: [{ name: 'Check balance', prompt: 'check my wallet balance' }, { name: 'Wallet info', prompt: 'show my wallet details' }] },
]

const TRIGGER_LABELS: Record<string, string> = { schedule: 'Schedule', email_event: 'Email', github_event: 'GitHub', notion_event: 'Notion', keyword: 'Keyword', manual: 'Manual' }
const TRIGGER_COLORS: Record<string, string> = { schedule: '#E8D368', email_event: '#E48D6C', github_event: '#94C4A3', keyword: '#5BA7CD', manual: '#EAE6D7' }

export default function WorkspaceWrapper() {
  return (
    <Suspense fallback={<Shell><div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>Loading...</div></Shell>}>
      <WorkspacePage />
    </Suspense>
  )
}

function WorkspacePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ideaParam = searchParams.get('idea')
  const fromOnboarding = searchParams.get('from') === 'onboarding'

  const [services, setServices] = useState<X402Service[]>([])
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(ideaParam ?? '')
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadSidebar = useCallback(async () => {
    const [sRes, iRes] = await Promise.allSettled([
      fetch('/api/x402/trending'),
      fetch('/api/integrations/status', { credentials: 'include' }),
    ])
    if (sRes.status === 'fulfilled' && sRes.value.ok) setServices((await sRes.value.json()).services ?? [])
    if (iRes.status === 'fulfilled' && iRes.value.ok) setIntegrations(await iRes.value.json())
  }, [])

  useEffect(() => { loadSidebar() }, [loadSidebar])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (ideaParam && messages.length === 0) sendMessage(ideaParam)
    else if (fromOnboarding && messages.length === 0) sendMessage('I just connected my integrations. What can I do?')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideaParam, fromOnboarding])

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return
    setMessages((prev) => [...prev, { role: 'user', content: text.trim() }])
    setInput('')
    setSending(true)

    try {
      const res = await fetch('/api/workspace/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.content })),
        }),
        credentials: 'include',
      })

      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => [...prev, {
          role: 'agent',
          content: data.response,
          toolCalls: data.toolCalls ?? [],
          recipe: data.recipe ?? undefined,
        }])
      } else {
        setMessages((prev) => [...prev, { role: 'agent', content: 'something went wrong. try again or rephrase.' }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'agent', content: 'connection error. try again.' }])
    } finally {
      setSending(false)
    }
  }

  const deployRecipe = async (recipe: ParsedRecipe) => {
    setSaving(true)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: recipe.name, instructions: recipe.instructions, trigger_type: recipe.trigger_type, trigger_config: recipe.trigger_config, category: recipe.category, enabled: true, notify_on_run: true }),
        credentials: 'include',
      })
      if (res.ok) {
        const { recipe: created } = await res.json()
        setMessages((prev) => [...prev, { role: 'agent', content: 'recipe deployed. smooth sailing from here, captain.' }])
        setTimeout(() => router.push(`/dashboard/recipes/${created.id}`), 1500)
      }
    } catch {} finally { setSaving(false) }
  }

  const toggleToolExpand = (idx: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  const connectedList = Object.entries(integrations).filter(([, v]) => v).map(([k]) => k)

  return (
    <Shell>
      {/* ── Sidebar ── */}
      <aside style={{ width: 320, flexShrink: 0, borderRight: '1.5px solid var(--ink)', display: 'flex', flexDirection: 'column', background: 'rgba(234,230,215,0.5)', overflowY: 'auto' }}>
        <header style={{ height: 72, borderBottom: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', padding: '0 1.5rem', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => router.push('/harbor')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16M12 20v-8M7 8c2 0 5-3 5-3s3 3 5 3M12 5v3" /></svg>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>Dock</span>
          </div>
          <button onClick={() => { setMessages([]); setInput('') }} title="New conversation" style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 4v16m-8-8h16" /></svg>
          </button>
        </header>

        <div style={{ flex: 1, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Your Integrations */}
          <SidebarSection title="Your Integrations">
            {[
              { key: 'google', label: 'Gmail & Calendar', icon: '📧' },
              { key: 'github', label: 'GitHub', icon: '🐙' },
              { key: 'notion', label: 'Notion', icon: '📝' },
              { key: 'openwallet', label: 'MoonPay Wallet', icon: '💰' },
            ].map((int) => (
              <SidebarItem key={int.key} icon={int.icon} label={int.label} connected={integrations[int.key]} onClick={() => setInput(`I want to do something with ${int.label}...`)} />
            ))}
          </SidebarSection>

          {/* x402 Services */}
          {services.length > 0 && (
            <SidebarSection title="x402 Services">
              {services.slice(0, 4).map((s, i) => (
                <SidebarItem key={i} icon="⚡" label={s.name} subtitle={s.price != null ? `$${s.price}` : undefined} onClick={() => setInput(`I want to use ${s.name} to ${s.recipe_idea.toLowerCase()}`)} />
              ))}
            </SidebarSection>
          )}

          {/* Dock Skills */}
          {SKILLS.map((group) => (
            <SidebarSection key={group.group} title={group.group}>
              {group.items.map((item) => (
                <SidebarItem key={item.name} label={item.name} onClick={() => setInput(item.prompt)} />
              ))}
            </SidebarSection>
          ))}
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', background: 'var(--cream)' }}>
        {/* Header */}
        <header style={{ height: 72, padding: '0 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1.5px solid var(--ink)', background: 'rgba(234,230,215,0.9)', backdropFilter: 'blur(8px)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1 style={{ fontFamily: "'Lora', serif", fontWeight: 700, fontSize: '1.5rem' }}>Recipe Workspace</h1>
            <span style={{ padding: '0.25rem 0.6rem', borderRadius: '1rem', border: '1.5px solid var(--ink)', fontSize: '0.6rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(148,196,163,0.3)' }}>
              {sending ? 'Working...' : 'Agent Active'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {connectedList.length > 0 && (
              <span style={{ fontSize: '0.7rem', opacity: 0.5, fontFamily: "'Outfit', sans-serif" }}>{connectedList.length} connected</span>
            )}
            <button onClick={() => router.push('/dashboard')} style={{ width: 40, height: 40, borderRadius: '50%', border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', cursor: 'pointer' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" /></svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', paddingTop: 24, paddingBottom: 180, paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div style={{ maxWidth: '48rem', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* No integrations banner */}
            {connectedList.length === 0 && messages.length === 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem',
                border: '1.5px solid var(--mesh-peach)', borderRadius: '0.75rem', background: 'rgba(228,141,108,0.1)',
                marginTop: '1rem',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mesh-peach)" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.8rem', flex: 1 }}>
                  Connect your integrations to unlock the full experience.
                </span>
                <a href="/onboarding" style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.75rem', color: 'var(--ink)', textDecoration: 'underline' }}>Connect</a>
              </div>
            )}

            {/* Hero */}
            {messages.length === 0 && (
              <div style={{
                position: 'relative', border: '1.5px solid var(--ink)', borderRadius: '2rem', overflow: 'hidden',
                minHeight: 260, display: 'flex', flexDirection: 'column', padding: '2.5rem 2rem 4rem',
                backgroundImage: 'radial-gradient(circle at 0% 0%, rgba(91,167,205,0.8) 0%, transparent 50%), radial-gradient(circle at 100% 0%, rgba(228,141,108,0.8) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(148,196,163,0.8) 0%, transparent 50%), radial-gradient(circle at 0% 100%, rgba(232,211,104,0.8) 0%, transparent 50%)',
                backgroundColor: '#E8D368', boxShadow: '4px 4px 0px var(--ink)', marginTop: '1rem',
              }}>
                <div style={{ position: 'relative', zIndex: 10, maxWidth: '32rem' }}>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: '1rem', border: '1.5px solid var(--ink)', background: 'rgba(234,230,215,0.5)', marginBottom: '0.75rem' }}>Live Agent</span>
                  <h2 style={{ fontFamily: "'Lora', serif", fontSize: '2.25rem', fontWeight: 700, lineHeight: 1.1, marginBottom: '0.75rem' }}>Chart a new course, Captain.</h2>
                  <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1rem', opacity: 0.9, lineHeight: 1.6 }}>
                    Explore capabilities, test ideas live, and build recipes. The agent runs real tools — ask it anything.
                  </p>
                </div>
                <div style={{ position: 'absolute', bottom: -1, left: 0, width: '100%', zIndex: 10 }}>
                  <svg viewBox="0 0 400 40" preserveAspectRatio="none" style={{ width: '100%', height: 36 }} fill="var(--cream)">
                    <path d="M0,40 L400,40 L400,20 C370,20 350,35 320,35 C290,35 280,10 250,10 C220,10 200,30 170,30 C140,30 120,5 90,5 C60,5 30,25 0,25 Z" />
                  </svg>
                </div>
              </div>
            )}

            {/* Chat */}
            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: '0.4rem' }}>
                <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: msg.role === 'user' ? 0.5 : 1, paddingLeft: msg.role === 'agent' ? '2.75rem' : 0 }}>
                  {msg.role === 'user' ? 'You' : 'Dock Agent'}
                </span>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', maxWidth: '90%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  {msg.role === 'agent' && (
                    <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--ink)', background: 'var(--mesh-mint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--cream)" stroke="var(--ink)" strokeWidth="1.5"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
                    {/* Tool calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {msg.toolCalls.map((tc, j) => (
                          <button key={j} onClick={() => toggleToolExpand(i * 100 + j)} style={{
                            width: '100%', textAlign: 'left', padding: '0.5rem 0.75rem', border: '1.5px solid var(--ink)', borderRadius: '0.6rem',
                            background: 'white', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '0.75rem',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ opacity: 0.5 }}>{expandedTools.has(i * 100 + j) ? '▾' : '▸'}</span>
                              <span style={{ fontWeight: 700 }}>{tc.name}</span>
                              <span style={{ opacity: 0.4, fontSize: '0.65rem' }}>
                                {typeof tc.input === 'object' && tc.input ? Object.values(tc.input as Record<string, unknown>).filter((v) => typeof v === 'string').slice(0, 1).join('') : ''}
                              </span>
                            </div>
                            {expandedTools.has(i * 100 + j) && (
                              <pre style={{ marginTop: '0.5rem', fontSize: '0.65rem', whiteSpace: 'pre-wrap', opacity: 0.6, maxHeight: 200, overflow: 'auto' }}>
                                {JSON.stringify(tc.result, null, 2)?.slice(0, 800)}
                              </pre>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Agent text */}
                    <div style={{
                      padding: '1rem 1.25rem', border: '1.5px solid var(--ink)',
                      borderRadius: msg.role === 'user' ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
                      background: msg.role === 'user' ? 'white' : 'var(--cream)', boxShadow: '2px 2px 0px var(--ink)',
                    }}>
                      <p style={{ fontSize: '0.95rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                    </div>

                    {/* Recipe card */}
                    {msg.recipe && <RecipeCard recipe={msg.recipe} onDeploy={deployRecipe} onRefine={(r) => setInput(`refine this recipe: ${r.instructions}. change it to `)} saving={saving} />}
                  </div>
                </div>
              </div>
            ))}

            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '0.5rem', opacity: 0.6 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--ink)', background: 'var(--mesh-mint)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--cream)" stroke="var(--ink)" strokeWidth="1.5"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
                </div>
                <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.85rem' }}>running tools, thinking...</span>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', zIndex: 20, background: 'linear-gradient(to top, var(--cream) 60%, transparent)', paddingTop: '3rem', paddingBottom: '1.5rem', paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div style={{ maxWidth: '48rem', margin: '0 auto', display: 'flex', alignItems: 'flex-end', gap: '0.75rem' }}>
            <button onClick={() => router.push('/dashboard/recipes/gallery')} title="Browse recipes" style={{ width: 48, height: 48, flexShrink: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', cursor: 'pointer', boxShadow: '2px 2px 0px var(--ink)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
            <div style={{ position: 'relative', flex: 1 }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask anything — test tools, explore x402 services, build a recipe..."
                style={{ width: '100%', background: 'white', border: '1.5px solid var(--ink)', borderRadius: '2rem', padding: '0.9rem 3.25rem 0.9rem 1.5rem', outline: 'none', fontSize: '0.95rem', boxShadow: '4px 4px 0px var(--ink)', fontFamily: "'Outfit', sans-serif", resize: 'none' }}
              />
              <button onClick={() => sendMessage(input)} disabled={!input.trim() || sending} style={{ position: 'absolute', right: 6, bottom: 6, top: 6, aspectRatio: '1', borderRadius: '50%', background: 'var(--ink)', color: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', opacity: !input.trim() || sending ? 0.3 : 1 }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
            <span style={{ fontSize: '0.6rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.35 }}>Live agent — runs real tools. Verify before deploying.</span>
          </div>
        </div>
      </main>
    </Shell>
  )
}

// ── Components ──

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100vh', width: '100%', display: 'flex', overflow: 'hidden', background: 'var(--cream)', color: 'var(--ink)' }}>{children}</div>
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: '0.6rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.5, marginBottom: '0.5rem', paddingLeft: '0.25rem' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>{children}</div>
    </div>
  )
}

function SidebarItem({ icon, label, subtitle, connected, onClick }: { icon?: string; label: string; subtitle?: string; connected?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.6rem',
      border: 'none', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer',
      fontFamily: "'Outfit', sans-serif", fontSize: '0.8rem', fontWeight: 500, textAlign: 'left',
      color: 'var(--ink)', transition: 'background 0.15s',
    }}
    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(91,167,205,0.1)' }}
    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent' }}
    >
      {icon && <span style={{ fontSize: '1rem', width: 24, textAlign: 'center' }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {subtitle && <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>{subtitle}</span>}
      {connected !== undefined && (
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? 'var(--mesh-mint)' : 'var(--mesh-peach)' }} />
      )}
    </button>
  )
}

function RecipeCard({ recipe, onDeploy, onRefine, saving }: { recipe: ParsedRecipe; onDeploy: (r: ParsedRecipe) => void; onRefine: (r: ParsedRecipe) => void; saving: boolean }) {
  const color = TRIGGER_COLORS[recipe.trigger_type] ?? 'var(--cream)'
  return (
    <div style={{ border: '1.5px solid var(--ink)', borderRadius: '0.75rem', background: 'white', padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1.5px solid var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.85rem', background: color }}>R</div>
          <h3 style={{ fontFamily: "'Lora', serif", fontWeight: 700, fontSize: '1.1rem' }}>{recipe.name}</h3>
        </div>
        <span style={{ fontSize: '0.6rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, border: '1.5px solid var(--ink)', borderRadius: '1rem', padding: '0.2rem 0.6rem', background: 'rgba(91,167,205,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Draft</span>
      </div>

      {/* Pipeline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
        <PipelineStep icon={recipe.trigger_type === 'schedule' ? '🕐' : recipe.trigger_type === 'email_event' ? '📧' : recipe.trigger_type === 'github_event' ? '🐙' : '▶️'} label="Trigger" color={color} />
        <Arrow />
        <PipelineStep icon="⚙️" label="Process" color="rgba(228,141,108,0.3)" />
        <Arrow />
        <PipelineStep icon="💬" label="Output" color="var(--mesh-mint)" />
      </div>

      <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '1rem' }}>
        {TRIGGER_LABELS[recipe.trigger_type] ?? recipe.trigger_type} · {recipe.category}
      </p>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={() => onDeploy(recipe)} disabled={saving} style={{ flex: 1, padding: '0.6rem', border: '1.5px solid var(--ink)', borderRadius: '0.75rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.85rem', background: 'var(--ink)', color: 'var(--cream)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {saving ? 'Deploying...' : 'Set Sail'}
        </button>
        <button onClick={() => onRefine(recipe)} style={{ flex: 1, padding: '0.6rem', border: '1.5px solid var(--ink)', borderRadius: '0.75rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.85rem', background: 'var(--cream)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          Refine
        </button>
      </div>
    </div>
  )
}

function PipelineStep({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
      <div style={{ width: 44, height: 44, border: '1.5px solid var(--ink)', borderRadius: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', background: color, boxShadow: '2px 2px 0px var(--ink)', fontSize: '1.15rem' }}>{icon}</div>
      <span style={{ fontSize: '0.55rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
    </div>
  )
}

function Arrow() {
  return (
    <div style={{ flex: 1, height: 1, background: 'var(--ink)', position: 'relative', minWidth: 20 }}>
      <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%) rotate(45deg)', width: 6, height: 6, borderTop: '1.5px solid var(--ink)', borderRight: '1.5px solid var(--ink)' }} />
    </div>
  )
}
