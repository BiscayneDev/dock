import { redirect } from 'next/navigation';
import { assistantContext } from '@/lib/assistant-store';
import { adminClient } from '@/lib/tenancy';
export const dynamic = 'force-dynamic';
// Owner view of phone tasks. Read-only by design: no control here approves, starts, retries or spends.
const GROUPS: [string, string][] = [['waiting_on_you', 'Waiting on you'], ['ready_for_review', 'Ready for you to check'], ['blocked', 'Stuck'], ['running', 'In progress'], ['delegated', 'In progress'], ['queued', 'Not started'], ['failed', 'Did not finish'], ['done', 'Done']];
const label = (key: string) => key.replace(/[-_]/g, ' ').replace(/^\w/, c => c.toUpperCase());
export default async function Tasks() {
    const ctx = await assistantContext();
    if (!ctx) redirect('/login');
    const db = adminClient();
    const { data: tasks } = await db.from('mobile_tasks').select('id,agent_key,state,waiting_on,review_policy,evidence,result_summary,updated_at').eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId).order('updated_at', { ascending: false }).limit(100);
    // Worker liveness only (a worker checked in recently). Not proof that it can execute.
    const { data: beat } = await db.from('mobile_workers').select('last_seen').order('last_seen', { ascending: false }).limit(1);
    const seen = beat?.[0]?.last_seen ? Math.max(0, Math.round((Date.now() - Date.parse(beat[0].last_seen)) / 1000)) : null;
    const workerLine = seen === null ? 'No worker has checked in yet.' : seen <= 300 ? `A worker checked in ${seen < 90 ? seen + 's' : Math.round(seen / 60) + ' min'} ago.` : `Last worker check-in was ${Math.round(seen / 60)} min ago. Tasks may wait.`;
    const ids = (tasks ?? []).map((t: any) => t.id);
    const { data: versions } = ids.length ? await db.from('mobile_task_versions').select('task_id,v,brief').in('task_id', ids) : { data: [] as any[] };
    const { data: handoffs } = ids.length ? await db.from('mobile_task_handoffs').select('task_id,status').in('task_id', ids) : { data: [] as any[] };
    const brief = (id: string) => (versions ?? []).filter((v: any) => v.task_id === id).sort((a: any, b: any) => b.v - a.v)[0]?.brief ?? 'Untitled task';
    const handoff = (id: string) => (handoffs ?? []).find((h: any) => h.task_id === id)?.status as string | undefined;
    // Only say what the ledger actually records. Nothing is inferred beyond it.
    const reason = (t: any) => {
        if (t.state === 'waiting_on_you') return `You decide: ${t.waiting_on}`;
        if (t.state === 'blocked') return handoff(t.id) === 'uncertain' ? `${label(t.agent_key)} started this, then stopped before reporting back. We don't know how far it got. It was not run again.` : 'Stopped. Nothing is running.';
        if (t.state === 'failed') return 'This did not finish. Nothing was retried automatically.';
        if (t.state === 'ready_for_review') return t.review_policy === 'owner' ? 'Needs your check before it counts as done.' : '';
        return '';
    };
    return <main className="mx-auto max-w-xl space-y-6 px-4 pt-8 pb-40">
        <header className="space-y-1"><p className="text-sm text-neutral-500">Dock / Tasks</p><h1 className="text-2xl font-semibold">{(tasks ?? []).some((t: any) => ['waiting_on_you', 'blocked', 'failed', 'ready_for_review'].includes(t.state)) ? 'What needs you' : 'Tasks'}</h1><p className="text-xs text-neutral-500">{workerLine}</p></header>
        {(tasks ?? []).length === 0 && <p className="text-neutral-500">Nothing yet. Tasks from your phone show up here.</p>}
        {GROUPS.map(([state, title], gi) => { if (GROUPS.findIndex(g => g[1] === title) !== gi) return null;
            const rows = (tasks ?? []).filter((t: any) => GROUPS.some(([s, n]) => n === title && s === t.state)); if (!rows.length) return null;
            return <section key={title} className="space-y-2"><h2 className="text-sm font-semibold text-neutral-600">{title} <span className="text-neutral-400">{rows.length}</span></h2>
                {rows.map((t: any) => { const ev: string[] = Array.isArray(t.evidence) ? t.evidence.filter((e: unknown) => typeof e === 'string') : [];
                    return <article key={t.id} className="space-y-1 rounded-lg border border-neutral-200 p-3">
                        <p className="text-sm font-medium">{brief(t.id)}</p>
                        {reason(t) && <p className="text-sm">{reason(t)}</p>}
                        {t.result_summary && <p className="text-sm text-neutral-300">{t.result_summary}</p>}
                        {ev.length > 0 && <ul className="list-disc pl-5 text-xs text-neutral-500">{ev.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                        <p className="text-xs text-neutral-500">{label(t.agent_key)}</p>
                    </article>; })}
            </section>; })}
    </main>;
}
