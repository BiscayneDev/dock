import type { Connections } from '@/lib/profile/connections'
import styles from '@/app/profile/profile.module.css'
import c from './connections.module.css'

function day(iso: string | null, tz: string): string {
    return iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown'
}
function ago(iso: string | null, tz: string): string {
    return iso ? new Date(iso).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet'
}

export default function ConnectionsPanel({ data, tz, connectLinks }: { data: Connections; tz: string; connectLinks: Array<{ name: string; auth: string }> }): React.JSX.Element {
    return (
        <>
            <section className={styles.section}>
                <h2 className={styles.h2}>Connected accounts</h2>
                <ul className={styles.list}>
                    {data.accounts.length === 0 && <li><p className={styles.empty}>Nothing connected yet.</p></li>}
                    {data.accounts.map((a) => (
                        <li key={a.provider} className={`${styles.item} ${c.acct}`}>
                            <div className={c.top}>
                                <div className={styles.grow}>
                                    <div className={styles.name}>{a.name}{a.primary ? <span className={c.tag}>primary</span> : null}</div>
                                    {a.account && <div className={styles.desc}>{a.account}</div>}
                                </div>
                                <form action="/api/integrations/disconnect" method="post">
                                    <input type="hidden" name="provider" value={a.provider} />
                                    <button type="submit" className={c.danger}>Disconnect</button>
                                </form>
                            </div>
                            <ul className={c.can}>
                                {a.can.map((t) => <li key={t}>{t}</li>)}
                            </ul>
                            <div className={styles.desc}>{a.cannot}</div>
                            <div className={c.meta}>Connected {day(a.connectedAt, tz)}</div>
                            <div className={c.meta}>
                                {a.revokesAtProvider
                                    ? 'Disconnecting also ends the grant at the provider.'
                                    : <>Disconnecting deletes Dinghy&rsquo;s copy of the token. {a.manageUrl ? <a href={a.manageUrl} target="_blank" rel="noopener noreferrer">Remove access in {a.name} too</a> : `To end the grant fully, remove Dinghy in ${a.name}.`}</>}
                            </div>
                        </li>
                    ))}
                    {connectLinks.map((l) => (
                        <li key={l.name} className={styles.item}>
                            <div className={styles.grow}><div className={styles.name}>{l.name}</div><div className={styles.desc}>Not connected</div></div>
                            <a className={styles.connect} href={l.auth}>Connect</a>
                        </li>
                    ))}
                    <li className={styles.item}>
                        <div className={styles.grow}><div className={styles.name}>X</div><div className={styles.desc}>Read posts and accounts. No account needed.</div></div>
                        <span className={styles.on}>On</span>
                    </li>
                </ul>
            </section>

            <section className={styles.section}>
                <h2 className={styles.h2}>Browser logins</h2>
                <ul className={styles.list}>
                    {data.capabilities.length === 0 && <li><p className={styles.empty}>None. If you teach Dinghy a site login from chat, it shows up here with an expiry.</p></li>}
                    {data.capabilities.map((k) => (
                        <li key={k.id} className={styles.item}>
                            <div className={styles.grow}>
                                <div className={styles.name}>{k.label}</div>
                                <div className={styles.desc}>{k.mode === 'write' ? 'Can act' : 'Read only'} · expires {day(k.expiresAt, tz)} · last used {ago(k.lastUsedAt, tz)}</div>
                            </div>
                            <form action="/api/user/capabilities/revoke" method="post">
                                <input type="hidden" name="id" value={k.id} />
                                <button type="submit" className={c.danger}>Revoke</button>
                            </form>
                        </li>
                    ))}
                </ul>
            </section>

            <section className={styles.section}>
                <h2 className={styles.h2}>Recent activity</h2>
                <ul className={styles.list}>
                    {data.runs.length === 0 && <li><p className={styles.empty}>No browser activity in the last 30 days.</p></li>}
                    {data.runs.map((r) => (
                        <li key={r.id} className={styles.item}>
                            <div className={styles.grow}>
                                <div className={styles.name}>{r.task}</div>
                                <div className={styles.desc}>{r.label} · {r.outcome ?? 'running'}</div>
                            </div>
                            <span className={styles.when}>{ago(r.startedAt, tz)}</span>
                        </li>
                    ))}
                </ul>
                <p className={c.foot}>Google, GitHub and health calls are not logged yet. This list covers browser logins only.</p>
            </section>
        </>
    )
}
