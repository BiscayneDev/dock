import { redirect } from 'next/navigation';
import { assistantContext } from '@/lib/assistant-store';
import { adminClient } from '@/lib/tenancy';
export const dynamic = 'force-dynamic';
// Owner view of phone tasks. Read-only: state changes here would be bookkeeping and this page
// has no control that approves, starts, retries or spends anything.
const GROUPS: [string, string, string][] = [
    ['waiting_on_you', 'Waiting on you', 'Needs your decision'],
    ['ready_for_review', 'Ready for review', 'Proof attached, review policy needs you'],
    ['blocked', 'Blocked', 'Stopped or outcome uncertain. Nothing is replayed automatically'],
    ['running', 'Running', ''], ['delegated', 'Delegated', ''], ['queued', 'Queued', ''], ['failed', 'Failed', ''], ['done', 'Done', 'Closed on recorded proof']
];
const HANDOFF: Record<string, string> = { pending: 'not sent', uncertain: 'sent, outcome unknown (not retried)', delivered: 'delivered', failed: 'failed (not retried)' };
export default async function Tasks() {
    const ctx = await assistantContext();
    if (!ctx) redirect('/login');
    const db = adminClient();
    const { data: tasks } = await db.from('mobile_tasks').select('id,agent_key,state,waiting_on,review_policy,evidence,updated_at').eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId).order('updated_at', { ascending: false }).limit(100);
    const ids = (tasks ?? []).map((t: any) => t.id);
    const { data: versions } = ids.length ? await db.from('mobile_task_versions').select('task_id,v,brief').in('task_id', ids) : { data: [] as any[] };
    const { data: handoffs } = ids.length ? await db.from('mobile_task_handoffs').select('task_id,status').in('task_id', ids) : { data: [] as any[] };
    const brief = (id: string) => (versions ?? []).filter((v: any) => v.task_id === id).sort((a: any, b: any) => b.v - a.v)[0]?.brief ?? '';
    const handoff = (id: string) => (handoffs ?? []).find((h: any) => h.task_id === id)?.status;
    return <main className="mx-auto max-w-xl space-y-6 px-4 pt-8 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <header className="space-y-1"><p className="text-sm text-neutral-500">Dock / Tasks</p><h1 className="text-2xl font-semibold">What needs you</h1>
        <p className="text-sm text-neutral-500">One home for each piece of work: the brief, who is accountable, its state and its proof.</p></header>
        {(tasks ?? []).length === 0 && <p className="text-neutral-500">No tasks yet.</p>}
        {GROUPS.map(([state, title, note]) => { const rows = (tasks ?? []).filter((t: any) => t.state === state); if (!rows.length) return null;
            return <section key={state} className="space-y-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">{title} <span className="text-neutral-400">{rows.length}</span></h2>
                {note && <p className="text-xs text-neutral-500">{note}</p>}
                {rows.map((t: any) => <article key={t.id} className="space-y-1 rounded-lg border border-neutral-200 p-3">
                    <p className="text-sm">{brief(t.id) || 'Untitled'}</p>
                    {t.waiting_on && <p className="text-sm font-medium">Decision: {t.waiting_on}</p>}
                    <p className="text-xs text-neutral-500">Agent {t.agent_key} · review {t.review_policy === 'owner' ? 'by you' : 'not required'} · proof {Array.isArray(t.evidence) ? t.evidence.length : 0}{handoff(t.id) ? ' · handoff ' + (HANDOFF[handoff(t.id)] ?? handoff(t.id)) : ''}</p>
                </article>)}
            </section>; })}
    </main>;
}
