import { adminClient } from '@/lib/tenancy';
export type Principal = {
    deviceId: string;
    ownerId: string;
    workspaceId: string;
};
export type MobileSession = {
    id: string;
    deviceId: string;
    ownerId: string;
    workspaceId: string;
    conversationId: string;
    projectId: string | null;
    agentId: string;
    repoKeys: string[];
};
const convert = (r: any): MobileSession => ({ id: r.id, deviceId: r.device_id, ownerId: r.owner_id, workspaceId: r.workspace_id, conversationId: r.conversation_id, projectId: r.project_id, agentId: r.agent_key, repoKeys: r.repo_keys });
export function mobileStore(principal: Principal) {
    const db = adminClient();
    const identity = { p_device: principal.deviceId, p_owner: principal.ownerId, p_workspace: principal.workspaceId };
    async function rpc(name: string, args: Record<string, unknown>) { const { data, error } = await db.rpc(name, { ...identity, ...args }); if (error)
        throw Error(error.message); return data; }
    async function session(id: string) { const { data: g, error: ge } = await db.from('mobile_grants').select('agent_key,project_id,repo_keys').eq('device_id', principal.deviceId).eq('owner_id', principal.ownerId).eq('workspace_id', principal.workspaceId).is('revoked_at', null).maybeSingle(); if (ge || !g)
        throw Error('Mobile grant required'); const { data, error } = await db.from('mobile_sessions').select('*').eq('id', id).eq('device_id', principal.deviceId).eq('owner_id', principal.ownerId).eq('workspace_id', principal.workspaceId).maybeSingle(); if (error)
        throw Error(error.message); if (data && (data.agent_key !== g.agent_key || data.project_id !== g.project_id || data.repo_keys.some((r: string) => !g.repo_keys.includes(r))))
        throw Error('Mobile grant narrowed'); return data ? convert(data) : null; }
    return {
        session,
        ackNotice: (id: string, noticeId: string) => rpc('mobile_ack_notice', { p_session: id, p_notice: noticeId }),
        async turnStatus(id: string, requestId: string) { if (!await session(id))
            throw Error('Session not owned'); const { data, error } = await db.from('mobile_turns').select('request_id,status,reply,created_at,finished_at').eq('session_id', id).eq('request_id', requestId).maybeSingle(); if (error)
            throw Error(error.message); return data; },
        async notices(id: string) { if (!await session(id))
            throw Error('Session not owned'); const { data, error } = await db.from('mobile_notices').select('id,kind,created_at,delivered_at').eq('session_id', id).order('created_at', { ascending: true }).limit(100); if (error)
            throw Error(error.message); return data; },
        async open(p: Principal, requestId: string) { const r = await rpc('mobile_open', { p_request: requestId }); return { sessionId: r.id }; },
        async messages(s: MobileSession) { const owned = await session(s.id); if (!owned)
            throw Error('Session not owned'); const { data, error } = await db.from('messages').select('role,content').eq('conversation_id', owned.conversationId).order('created_at', { ascending: false }).limit(80); if (error)
            throw Error(error.message); return (data ?? []).reverse(); },
        claim: (s: MobileSession, requestId: string, fingerprint: string) => rpc('mobile_claim', { p_session: s.id, p_request: requestId, p_fingerprint: fingerprint }),
        complete: (s: MobileSession, requestId: string, fingerprint: string, x: any) => rpc('mobile_complete', { p_session: s.id, p_request: requestId, p_fingerprint: fingerprint, p_user: x.user, p_assistant: x.assistant, p_reply: x.reply }),
        async fail(s: MobileSession, requestId: string, fingerprint: string) { if (!await session(s.id))
            throw Error('Session not owned'); const { error } = await db.from('mobile_turns').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('session_id', s.id).eq('request_id', requestId).eq('fingerprint', fingerprint).eq('status', 'pending'); if (error)
            throw Error(error.message); }
    };
}
