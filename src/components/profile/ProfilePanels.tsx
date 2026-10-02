'use client'
import { useEffect, useState } from 'react'
import { portfolioTotal, chainName, type Portfolio } from '@/lib/profile/portfolio'
import { fileLinkState, type FileSummary } from '@/lib/profile/file-display'
import styles from './profile-panels.module.css'
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export type PanelsFixture = { portfolio: Portfolio | null; files: FileSummary[]; error?: boolean }
export function WalletCard({ data, error, loading, refresh }: { data: Portfolio | null; error: boolean; loading: boolean; refresh: () => void }) {
  const [choice, setChoice] = useState('all')
  const wallets = data?.wallets ?? []
  const selected = choice === 'all' ? wallets : wallets.filter((w, i) => (w.address ?? `missing-${i}`) === choice)
  const total = portfolioTotal(selected)
  const ready = data?.state === 'ready'
  const dates = selected.map(w => w.asOf).filter((d): d is string => !!d).sort()
  return <section className={styles.wallet} aria-labelledby="wallet-title" aria-busy={loading}>
    <div className={styles.row}><span className={styles.eyebrow}>PayBox</span><button type="button" className={styles.refresh} onClick={refresh} disabled={loading}> {loading ? 'Checking…' : 'Refresh'} ↻</button></div>
    <h2 id="wallet-title" className={styles.walletLabel}>Wallet value</h2>
    {loading && !data ? <p className={styles.message}>Checking your wallets…</p>
      : error || data?.state === 'error' ? <><p className={styles.message}>Wallet value is unavailable right now.</p><p className={styles.sub}>Nothing is shown as zero when a balance cannot be checked.</p></>
      : data?.state === 'disconnected' ? <><p className={styles.message}>Your wallet, at a glance.</p><p className={styles.sub}>Connect PayBox to see the wallets you share with Dinghy. Read-only. Nothing moves.</p><a className={styles.button} href="/api/integrations/paybox/auth">Connect PayBox →</a></>
      : data?.state === 'no_wallets' ? <><p className={styles.message}>PayBox is connected.</p><p className={styles.sub}>Share a wallet with Dinghy in PayBox to see its value here.</p><a className={styles.button} href="https://app.paybox.sh" target="_blank" rel="noopener noreferrer">Open PayBox →</a></>
      : ready ? <>
        {wallets.length > 1 && <label className={styles.selectLabel}>Showing <select value={choice} onChange={e => setChoice(e.target.value)}><option value="all">All shared wallets</option>{wallets.map((w, i) => <option key={w.address ?? i} value={w.address ?? `missing-${i}`}>{w.name}</option>)}</select></label>}
        <div className={styles.value}>{total === null ? 'Not fully priced' : money(total)}</div>
        <p className={styles.sub}>Estimated USD · Wallets shared with Dinghy{data.truncated ? ' · First 12 wallets only' : ''}</p>
        {total === null && <p className={styles.note}>Some prices or balances are unavailable. No total is estimated from incomplete data.</p>}
        {selected.map((w, i) => <div key={w.address ?? i} className={styles.holdings}>
          <div className={styles.row}><span className={styles.walletName}>{w.name}</span><span className={styles.small}>{w.address ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : 'Address unavailable'}</span></div>
          {w.status === 'unavailable' ? <p className={styles.sub}>Balance unavailable</p> : w.holdings.length === 0 ? <p className={styles.sub}>No token holdings returned.</p> : w.holdings.slice(0, 3).map((h, j) => <div className={styles.holding} key={`${h.symbol}-${h.network}-${j}`}><div><span>{h.symbol}</span><small>{chainName(h.network) || 'Network unavailable'}{h.amount ? ` · ${h.amount}` : ''}</small></div><span>{h.usd === null ? 'Price unavailable' : money(h.usd)}</span></div>)}
        </div>)}
        <p className={styles.foot}>{selected.length > 0 && dates.length === selected.length ? `Source updated ${new Date(dates[0]).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Source update time unavailable'}. Not a spending allowance.</p>
      </> : null}
  </section>
}
export function FilesShelf({ files, error, loading, more, loadMore, retry }: { files: FileSummary[]; error: boolean; loading: boolean; more: boolean; loadMore: () => void; retry: () => void }) {
  const [filter, setFilter] = useState('all')
  const visible = files.filter(f => filter === 'all' || f.kind === filter)
  return <section className={styles.shelf} aria-labelledby="files-title"><div className={styles.row}><h2 id="files-title" className={styles.heading}>Your files</h2><span className={styles.small}>Made with Dinghy</span></div>
    <p className={styles.sub}>Plans, notes and itineraries. All in one place.</p>
    {error && <div className={styles.empty}><p>Your files could not be loaded.</p><button className={styles.textButton} onClick={retry}>Try again →</button></div>}
    {!error && !files.length && <div className={styles.empty}><span className={styles.fileIcon} aria-hidden="true">▤</span><h3>{loading ? 'Loading your files…' : 'A little room for what comes next.'}</h3>{!loading && <p>Ask Dinghy for a plan, a note or an itinerary.</p>}</div>}
    {!!files.length && <div className={styles.filters}>{[['all', 'All'], ['file', 'Files'], ['itinerary', 'Itineraries']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>}
    {!!files.length && !visible.length && <p className={styles.sub}>No matching files in the loaded pages.</p>}
    <div className={styles.grid}>{visible.map(f => { const state = fileLinkState(f); return <article className={styles.file} key={f.id}>
      <div className={styles.cover}><span className={styles.fileIcon} aria-hidden="true">{f.kind === 'itinerary' ? '⌁' : '▤'}</span><span>{f.kind === 'itinerary' ? 'Itinerary' : 'File'}</span></div>
      <div className={styles.fileInfo}><h3>{f.title}</h3><p>{new Date(f.created_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })} · {f.format === 'page' ? 'Page' : f.format.toUpperCase()}</p>
        {state === 'revoked' ? <span className={styles.small}>Link revoked</span> : <a className={styles.open} href={state === 'live' ? f.url! : `/profile/files/${f.id}`} target={state === 'live' ? '_blank' : undefined} rel={state === 'live' ? 'noopener noreferrer' : undefined}>{state === 'expired' ? 'View saved copy →' : state === 'private' ? 'Open saved copy →' : 'Open →'}</a>}
        <span className={styles.status}>{state === 'live' ? `Shared link${f.expires_at ? ` expires ${new Date(f.expires_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}` : ''}` : state === 'expired' ? 'Link expired' : state === 'private' ? 'Only you can open this saved copy' : 'No longer available'}</span>
      </div></article> })}</div>
    {more && <button className={styles.textButton} disabled={loading} onClick={loadMore}>{loading ? 'Loading…' : 'Show more files →'}</button>}
    <p className={styles.foot}>Your library is private. Anyone with a shared here.now link can open that file until the link expires or is revoked.</p>
  </section>
}
export default function ProfilePanels({ fixture }: { fixture?: PanelsFixture }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(fixture?.portfolio ?? null)
  const [files, setFiles] = useState<FileSummary[]>(fixture?.files ?? [])
  const [walletError, setWalletError] = useState(fixture?.error ?? false)
  const [filesError, setFilesError] = useState(fixture?.error ?? false)
  const [walletLoading, setWalletLoading] = useState(!fixture)
  const [filesLoading, setFilesLoading] = useState(!fixture)
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(0)
  async function loadWallet() {
    if (fixture) return
    setWalletLoading(true)
    try { const res = await fetch('/api/user/paybox/portfolio', { cache: 'no-store', signal: AbortSignal.timeout(15000) }); if (!res.ok) throw new Error(); setPortfolio(await res.json()); setWalletError(false) }
    catch { setPortfolio(null); setWalletError(true) } finally { setWalletLoading(false) }
  }
  async function loadFiles(nextPage = 0) {
    if (fixture) return
    setFilesLoading(true)
    try { const res = await fetch(`/api/user/files?page=${nextPage}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); if (!res.ok) throw new Error(); const data = await res.json(); setFiles(old => nextPage ? [...old, ...data.files.filter((f: FileSummary) => !old.some(o => o.id === f.id))] : data.files); setMore(data.more); setPage(nextPage); setFilesError(false) }
    catch { setFilesError(true) } finally { setFilesLoading(false) }
  }
  // Only on mount and explicit refresh. Never polls in the background.
  useEffect(() => { if (!fixture) { void loadWallet(); void loadFiles() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className={styles.panels}><WalletCard data={portfolio} error={walletError} loading={walletLoading} refresh={() => void loadWallet()} /><FilesShelf files={files} error={filesError} loading={filesLoading} more={more} loadMore={() => void loadFiles(page + 1)} retry={() => void loadFiles()} /></div>
}
