import { redirect } from 'next/navigation';
import { assistantContext } from '@/lib/assistant-store';
import { adminClient } from '@/lib/tenancy';
import Link from 'next/link';
import GrantEditor from './GrantEditor';
import { loadRoster } from '@/lib/briefs-store';
import { readFile } from 'node:fs/promises';
export const dynamic = 'force-dynamic';
export default async function MobileFoundations() {
    const ctx = await assistantContext();
    if (!ctx)
        redirect('/login');
    const db = adminClient();
    const { data: sessions, error } = await db.from('mobile_sessions').select('id,conversation_id,agent_key,repo_keys,project_id').eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId).limit(50);
    const { data: proposals } = await db.from('mobile_task_proposals').select('id,proposal,status,created_at').eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId).order('created_at', { ascending: false }).limit(50);
    const { data: devices } = await db.from('devices').select('id,name').eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId).eq('purpose', 'mobile').is('revoked_at', null);
    const agents = await loadRoster(ctx.supabase, ctx.workspaceId).catch(() => []);
    let repositoryKeys: string[] = [];
    try {
        const path = process.env.DOCK_KNOWLEDGE_MANIFEST;
        if (path?.startsWith('/'))
            repositoryKeys = JSON.parse(await readFile(path, 'utf8')).repositories.map((r: {
                key: string;
            }) => r.key);
    }
    catch { }
    return <main className="mx-auto max-w-3xl space-y-8 px-5 pt-10 pb-[calc(7rem+env(safe-area-inset-bottom))]"><header className="space-y-3"><p className="text-sm text-neutral-500">Dock / Mobile</p><h1 className="text-3xl font-semibold">One conversation. Shared knowledge.</h1><p className="text-neutral-500">T3 is your mobile inbox. Dock keeps conversations, repository knowledge and memory together. Specialist work stays separate.</p></header><section className="rounded-xl border p-5"><h2 className="font-semibold">Connection status</h2><p className="mt-2 text-sm">{error ? 'Mobile schema is not activated. Your existing phone environment is unchanged.' : process.env.DOCK_MOBILE_ENABLED === 'true' ? 'Bridge enabled. Device and repository grants still apply.' : 'Bridge paused. Existing phone environment is unchanged.'}</p><p className="mt-2 text-sm text-neutral-500">Native push requires T3 Connect and Device Notifications. An inbox receipt is not proof that your phone received a notification.</p></section><GrantEditor devices={devices ?? []} agents={agents} repositoryKeys={repositoryKeys}/><section className="space-y-3"><h2 className="text-xl font-semibold">Connected conversations</h2>{!(sessions?.length) ? <p className="text-neutral-500">No Dock mobile conversations yet.</p> : sessions.map(s => <article key={s.id} className="rounded-xl border p-4"><p>{s.agent_key}</p><p className="mt-1 break-words text-sm text-neutral-500">Knowledge: {(s.repo_keys as string[]).join(', ') || 'No repositories granted'}</p><Link className="mt-3 inline-block underline" href={'/conversations?id=' + encodeURIComponent(s.conversation_id)}>Open canonical conversation</Link></article>)}</section><section className="space-y-3"><h2 className="text-xl font-semibold">Task proposals</h2><p className="text-sm text-neutral-500">Messages can propose work. A proposal is not approval, a purchase or a running task. Isolated dispatch is not activated.</p>{!(proposals?.length) ? <p className="text-neutral-500">No task proposals yet.</p> : proposals.map(p => <article key={p.id} className="space-y-2 rounded-xl border p-4"><div className="flex items-start justify-between gap-4"><h3 className="font-semibold">{p.proposal.goal}</h3><span className="text-xs uppercase text-neutral-500">{p.status}</span></div><p className="text-sm">{p.proposal.context}</p><ul className="list-disc pl-5 text-sm">{p.proposal.deliverables?.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul><p className="text-sm">Budget cap: ${(p.proposal.budgetCents / 100).toFixed(2)}</p><p className="text-sm">Agents: {p.proposal.assignments?.map((a: {
                agentKey: string;
            }) => a.agentKey).join(', ')}</p><p className="text-sm">Risks: {p.proposal.riskFlags?.map((r: string) => ({ spends_money: 'Spends money', contacts_people: 'Contacts people', publishes_externally: 'Publishes externally', deletes_data: 'Deletes data' }[r] ?? r)).join(', ') || 'None declared'}</p><p className="text-sm text-neutral-500">Not started. Execution approval is unavailable until the isolated runner is configured.</p></article>)}</section></main>;
}
