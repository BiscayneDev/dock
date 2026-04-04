'use client'

import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PlaygroundPanel } from './playground'
import './workspace.css'

interface X402Service { name: string; description: string; url: string; price: number | null; category: string | null; recipe_idea: string }
interface ToolCallEntry { name: string; input: unknown; result: unknown }
interface ParsedRecipe { name: string; trigger_type: string; trigger_config: Record<string, unknown>; instructions: string; category: string }
interface Message { role: 'user' | 'agent'; content: string; toolCalls?: ToolCallEntry[]; recipe?: ParsedRecipe; quickReplies?: string[] }

const SKILLS = [
  { group: 'Email', items: [{ name: 'Search emails', prompt: 'search my recent emails for...' }, { name: 'Summarize inbox', prompt: 'summarize my unread emails from the last few hours' }] },
  { group: 'Calendar', items: [{ name: "Today's schedule", prompt: "what's on my calendar today?" }, { name: 'Find free time', prompt: 'find free time on my calendar this week' }] },
  { group: 'GitHub', items: [{ name: 'Open PRs', prompt: 'show me open pull requests' }, { name: 'My issues', prompt: 'list issues assigned to me' }] },
  { group: 'Web & x402', items: [{ name: 'Search the web', prompt: 'search the web for...' }, { name: 'Browse x402 APIs', prompt: 'show me x402 services I can use' }] },
  { group: 'Wallet', items: [{ name: 'Check balance', prompt: 'check my wallet balance' }] },
  { group: 'Health', items: [{ name: 'Sleep summary', prompt: 'how did I sleep last night?' }, { name: 'Recovery score', prompt: "what's my readiness/recovery score today?" }, { name: 'Daily health snapshot', prompt: 'give me a full health summary for today' }] },
  { group: 'Twitter', items: [{ name: 'My timeline', prompt: "what's happening on my twitter timeline?" }, { name: 'Search tweets', prompt: 'search twitter for...' }, { name: 'Check a user', prompt: "what has @... been tweeting about?" }] },
  { group: 'MoonPay', items: [{ name: 'Token prices', prompt: 'what is the price of SOL right now?' }, { name: 'Trending tokens', prompt: 'what tokens are trending right now?' }, { name: 'Prediction markets', prompt: 'show me the top prediction markets on Polymarket' }, { name: 'Token analysis', prompt: 'analyze ETH — price, volume, trends' }, { name: 'Swap tokens', prompt: 'I want to swap SOL for USDC' }, { name: 'Bridge tokens', prompt: 'bridge ETH from Ethereum to Base' }] },
]

// Extract [quick:label] tags from agent response as quick reply options
function extractQuickReplies(text: string): string[] {
  const matches = text.match(/\[quick:(.*?)\]/g)
  if (!matches) return []
  return matches.map((m) => m.replace(/\[quick:(.*?)\]/, '$1').trim())
}

const TRIGGER_LABELS: Record<string, string> = { schedule: 'Schedule', email_event: 'Email', github_event: 'GitHub', notion_event: 'Notion', keyword: 'Keyword', manual: 'Manual' }
const TRIGGER_COLORS: Record<string, string> = { schedule: 'var(--mesh-yellow)', email_event: 'var(--mesh-peach)', github_event: 'var(--mesh-mint)', keyword: 'var(--mesh-cyan)', manual: 'var(--cream)' }

export default function WorkspaceWrapper() {
  return (
    <Suspense fallback={<Shell><div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontFamily: "'Outfit', sans-serif" }}>Loading...</div></Shell>}>
      <WorkspacePage />
    </Suspense>
  )
}

function WorkspacePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ideaParam = searchParams.get('idea')

  const [services, setServices] = useState<X402Service[]>([])
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(ideaParam ?? '')
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [playground, setPlayground] = useState<X402Service | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadSidebar = useCallback(async () => {
    const [sRes, iRes] = await Promise.allSettled([fetch('/api/x402/trending'), fetch('/api/integrations/status', { credentials: 'include' })])
    if (sRes.status === 'fulfilled' && sRes.value.ok) setServices((await sRes.value.json()).services ?? [])
    if (iRes.status === 'fulfilled' && iRes.value.ok) setIntegrations(await iRes.value.json())
  }, [])

  useEffect(() => { loadSidebar() }, [loadSidebar])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (ideaParam && messages.length === 0) sendMessage(ideaParam) }, [ideaParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return
    setMessages((prev) => [...prev, { role: 'user', content: text.trim() }])
    setInput('')
    setSending(true)
    try {
      const connectedList = Object.entries(integrations).filter(([, v]) => v).map(([k]) => k)
      const contextNote = messages.length === 0 && connectedList.length > 0 ? `\n[user has these integrations connected: ${connectedList.join(', ')}]` : ''
      const res = await fetch('/api/workspace/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text + contextNote, history: messages.map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.content })) }), credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        // Extract quick reply suggestions from the response
        const quickReplies = extractQuickReplies(data.response)
        const cleanResponse = data.response.replace(/\[quick:.*?\]/g, '').trim()
        setMessages((prev) => [...prev, { role: 'agent', content: cleanResponse, toolCalls: data.toolCalls ?? [], recipe: data.recipe ?? undefined, quickReplies }])
      } else { setMessages((prev) => [...prev, { role: 'agent', content: 'something went wrong. try again or rephrase.' }]) }
    } catch { setMessages((prev) => [...prev, { role: 'agent', content: 'connection error. try again.' }]) }
    finally { setSending(false) }
  }

  const deployRecipe = async (recipe: ParsedRecipe) => {
    setSaving(true)
    try {
      const res = await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: recipe.name, instructions: recipe.instructions, trigger_type: recipe.trigger_type, trigger_config: recipe.trigger_config, category: recipe.category, enabled: true, notify_on_run: true }), credentials: 'include' })
      if (res.ok) { const { recipe: created } = await res.json(); setMessages((prev) => [...prev, { role: 'agent', content: 'recipe deployed. smooth sailing from here, captain.' }]); setTimeout(() => router.push(`/dashboard/recipes/${created.id}`), 1500) }
    } catch {} finally { setSaving(false) }
  }

  const toggleToolExpand = (idx: number) => setExpandedTools((prev) => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }

  return (
    <Shell>
      {/* Sidebar */}
      <aside className="ws-sidebar">
        <header className="ws-sidebar-header">
          <div className="ws-logo" onClick={() => router.push('/harbor')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16M12 20v-8M7 8c2 0 5-3 5-3s3 3 5 3M12 5v3" /></svg>
            <span>Dock</span>
          </div>
          <button className="ws-icon-btn" onClick={() => { setMessages([]); setInput('') }} title="New conversation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 4v16m-8-8h16" /></svg>
          </button>
        </header>
        <div className="ws-sidebar-scroll">
          <button className="ws-new-btn" onClick={() => { setMessages([]); setInput('') }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span>New Conversation</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" style={{ marginLeft: 'auto' }}><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <Section title="Your Integrations">
            {[{ key: 'google', label: 'Gmail & Calendar', icon: '📧' }, { key: 'github', label: 'GitHub', icon: '🐙' }, { key: 'notion', label: 'Notion', icon: '📝' }, { key: 'openwallet', label: 'MoonPay Wallet', icon: '💰' }, { key: 'oura', label: 'Oura Ring', icon: '💤' }, { key: 'whoop', label: 'WHOOP', icon: '💪' }, { key: 'twitter', label: 'Twitter / X', icon: '🐦' }].map((int) => (
              <SideItem key={int.key} icon={int.icon} label={int.label} dot={integrations[int.key] ? 'var(--mesh-mint)' : 'var(--mesh-peach)'} onClick={() => setInput(`I want to do something with ${int.label}...`)} />
            ))}
          </Section>
          {services.length > 0 && (
            <Section title="x402 Services">
              {services.slice(0, 4).map((s, i) => (
                <ServiceCard key={i} name={s.name} desc={s.description} price={s.price} idx={i} onClick={() => setPlayground(s)} />
              ))}
            </Section>
          )}
          {SKILLS.map((g) => (
            <Section key={g.group} title={g.group}>
              {g.items.map((item) => <SideItem key={item.name} label={item.name} onClick={() => setInput(item.prompt)} />)}
            </Section>
          ))}
          <div className="ws-wave"><svg width="120" height="40" viewBox="0 0 120 40" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M5 20 Q 20 5, 35 20 T 65 20 T 95 20 T 115 20" /><path d="M25 15 L 25 30 M 55 12 L 55 35 M 85 18 L 85 28" /></svg></div>
        </div>
      </aside>

      {/* Main */}
      <main className="ws-main">
        <header className="ws-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1 className="ws-title">Recipe Workspace</h1>
            <span className={`ws-status ${sending ? 'ws-status-busy' : ''}`}>{sending ? 'Working...' : 'Agent Active'}</span>
          </div>
          <button className="ws-icon-btn ws-avatar" onClick={() => router.push('/dashboard')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" /></svg>
          </button>
        </header>

        <div ref={scrollRef} className="ws-scroll">
          <div className="ws-scroll-inner">
            {/* x402 Playground */}
            {playground && (
              <PlaygroundPanel
                serviceName={playground.name}
                serviceUrl={playground.url ?? ''}
                serviceDescription={playground.description}
                onClose={() => setPlayground(null)}
                onBuildRecipe={(desc) => { setPlayground(null); setInput(desc) }}
              />
            )}

            {messages.length === 0 && !playground && (
              <div className="ws-hero mesh-bg">
                <div className="ws-hero-inner">
                  <span className="ws-hero-badge">Live Agent</span>
                  <h2 className="ws-hero-h2">Chart a new course, Captain.</h2>
                  <p className="ws-hero-p">Explore capabilities, test ideas live, and build recipes. The agent runs real tools — ask it anything.</p>
                </div>
                <div className="ws-hero-scallop"><svg viewBox="0 0 400 40" preserveAspectRatio="none" fill="var(--cream)"><path d="M0,40 L400,40 L400,20 C370,20 350,35 320,35 C290,35 280,10 250,10 C220,10 200,30 170,30 C140,30 120,5 90,5 C60,5 30,25 0,25 Z" /></svg></div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`ws-msg ws-msg-${msg.role}`}>
                <div className="ws-msg-label">
                  {msg.role === 'agent' && <div className="ws-agent-dot"><svg width="14" height="14" viewBox="0 0 24 24" fill="var(--cream)" stroke="var(--ink)" strokeWidth="1.5"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg></div>}
                  <span className="ws-meta">{msg.role === 'user' ? 'You' : 'Dock Agent'}</span>
                </div>
                <div className={`ws-msg-wrap ${msg.role === 'user' ? 'ws-msg-wrap-right' : ''}`}>
                  <div className="ws-msg-col">
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="ws-tools">
                        {msg.toolCalls.map((tc, j) => (
                          <button key={j} className="ws-tool" onClick={() => toggleToolExpand(i * 100 + j)}>
                            <div className="ws-tool-head">
                              <span style={{ opacity: 0.5 }}>{expandedTools.has(i * 100 + j) ? '▾' : '▸'}</span>
                              <strong>{tc.name}</strong>
                              <span className="ws-tool-hint">{typeof tc.input === 'object' && tc.input ? String(Object.values(tc.input as Record<string, unknown>).filter((v) => typeof v === 'string')[0] ?? '').slice(0, 40) : ''}</span>
                            </div>
                            {expandedTools.has(i * 100 + j) && <pre className="ws-tool-out">{JSON.stringify(tc.result, null, 2)?.slice(0, 800)}</pre>}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={`ws-bubble ws-bubble-${msg.role}`}><p>{msg.content}</p></div>
                    {msg.recipe && <RecipeCard recipe={msg.recipe} onDeploy={deployRecipe} onRefine={(r) => setInput(`refine this recipe: ${r.instructions}. change it to `)} saving={saving} />}
                    {/* Quick reply chips */}
                    {msg.quickReplies && msg.quickReplies.length > 0 && i === messages.length - 1 && (
                      <div className="ws-quick-replies">
                        {msg.quickReplies.map((reply, j) => (
                          <button key={j} className="ws-quick-chip" onClick={() => sendMessage(reply)}>{reply}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {sending && <div className="ws-typing"><div className="ws-agent-dot"><svg width="14" height="14" viewBox="0 0 24 24" fill="var(--cream)" stroke="var(--ink)" strokeWidth="1.5"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg></div><span>running tools, thinking...</span></div>}
          </div>
        </div>

        <div className="ws-input-area">
          <div className="ws-input-row">
            <button className="ws-input-plus" onClick={() => router.push('/dashboard/recipes/gallery')} title="Browse recipes">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
            <div className="ws-input-wrap">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} rows={1} placeholder="Ask anything — test tools, explore x402 services, build a recipe..." className="ws-input" />
              <button onClick={() => sendMessage(input)} disabled={!input.trim() || sending} className="ws-send">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </div>
          <p className="ws-disclaimer">Live agent — runs real tools. Verify before deploying.</p>
        </div>
      </main>
    </Shell>
  )
}

/* ── Subcomponents ── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      {/* Styles imported via workspace.css */}
      <div className="ws-shell">{children}</div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="ws-section-title">{title}</h3><div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>{children}</div></div>
}

function SideItem({ icon, label, dot, onClick }: { icon?: string; label: string; dot?: string; onClick: () => void }) {
  return (
    <button className="ws-side-item" onClick={onClick}>
      {icon && <span style={{ fontSize: '1rem', width: 24, textAlign: 'center' }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {dot && <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />}
    </button>
  )
}

function ServiceCard({ name, desc, price, idx, onClick }: { name: string; desc: string; price: number | null; idx: number; onClick: () => void }) {
  const colors = ['var(--mesh-cyan)', 'var(--mesh-peach)', 'var(--mesh-mint)', 'var(--mesh-yellow)']
  return (
    <button className="ws-svc-card" onClick={onClick}>
      <div className="ws-svc-glow" style={{ background: colors[idx % 4] }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem', position: 'relative', zIndex: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: 'var(--border-w) solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', fontSize: '1rem' }}>⚡</div>
        {price != null && price > 0 && <span style={{ fontSize: '0.6rem', fontWeight: 700, border: 'var(--border-w) solid var(--ink)', borderRadius: '1rem', padding: '0.12rem 0.4rem', background: 'var(--mesh-yellow)' }}>${price}</span>}
      </div>
      <h4 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem', position: 'relative', zIndex: 10 }}>{name}</h4>
      <p style={{ fontSize: '0.7rem', opacity: 0.7, lineHeight: 1.5, position: 'relative', zIndex: 10 }}>{desc.slice(0, 70)}</p>
    </button>
  )
}

function RecipeCard({ recipe, onDeploy, onRefine, saving }: { recipe: ParsedRecipe; onDeploy: (r: ParsedRecipe) => void; onRefine: (r: ParsedRecipe) => void; saving: boolean }) {
  const color = TRIGGER_COLORS[recipe.trigger_type] ?? 'var(--cream)'
  const icon = recipe.trigger_type === 'schedule' ? '🕐' : recipe.trigger_type === 'email_event' ? '📧' : recipe.trigger_type === 'github_event' ? '🐙' : recipe.trigger_type === 'keyword' ? '💬' : '▶️'
  return (
    <div className="ws-recipe">
      <div className="ws-recipe-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><div className="ws-recipe-num" style={{ background: color }}>{icon}</div><h3 className="ws-recipe-name">{recipe.name}</h3></div>
        <span className="ws-recipe-draft">Draft</span>
      </div>
      <div className="ws-pipe">
        <div className="ws-pipe-step"><div className="ws-pipe-icon" style={{ background: color }}>{icon}</div><span className="ws-pipe-label">Trigger</span></div>
        <div className="ws-pipe-arrow" />
        <div className="ws-pipe-step"><div className="ws-pipe-icon" style={{ background: 'rgba(228,141,108,0.3)' }}>⚙️</div><span className="ws-pipe-label">Process</span></div>
        <div className="ws-pipe-arrow" />
        <div className="ws-pipe-step"><div className="ws-pipe-icon" style={{ background: 'var(--mesh-mint)' }}>💬</div><span className="ws-pipe-label">Output</span></div>
      </div>
      <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.5rem' }}>{TRIGGER_LABELS[recipe.trigger_type] ?? recipe.trigger_type} · {recipe.category}</p>
      <div className="ws-recipe-actions">
        <button onClick={() => onDeploy(recipe)} disabled={saving} className="ws-r-btn ws-r-btn-primary">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {saving ? 'Deploying...' : 'Set Sail (Deploy)'}
        </button>
        <button onClick={() => onRefine(recipe)} className="ws-r-btn ws-r-btn-secondary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          Refine Logic
        </button>
      </div>
    </div>
  )
}
