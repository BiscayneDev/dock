import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { assistantContext, isUuid, projectInWorkspace } from '@/lib/assistant-store';
import { adminClient } from '@/lib/tenancy';
import { loadRoster } from '@/lib/briefs-store';
export const runtime = 'nodejs';
async function repoKeys() {
    const p = process.env.DOCK_KNOWLEDGE_MANIFEST;
    if (!p?.startsWith('/'))
        throw Error('Knowledge manifest unavailable');
    const m = JSON.parse(await readFile(p, 'utf8'));
    return m.repositories.map((r: {
        key: string;
    }) => r.key) as string[];
}
export async function GET() {
    const ctx = await assistantContext();
    if (!ctx)
        return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    try {
        const { data, error } = await adminClient().from('mobile_grants').select('device_id,agent_key,project_id,repo_keys,inference_enabled,revoked_at').eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId);
        if (error)
            throw error;
        return NextResponse.json({ grants: data, repositoryKeys: await repoKeys() });
    }
    catch {
        return NextResponse.json({ error: 'Mobile foundations not configured' }, { status: 503 });
    }
}
export async function PUT(request: Request) {
    const ctx = await assistantContext();
    if (!ctx)
        return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    // Owner account change only, never authorized through the paired device.
    if (request.headers.get('origin') !== new URL(request.url).origin)
        return NextResponse.json({ error: 'Same-origin owner action required' }, { status: 403 });
    try {
        const body = await request.json();
        if (!isUuid(body.deviceId) || typeof body.agentKey !== 'string' || !Array.isArray(body.repoKeys) || body.repoKeys.length > 100 || typeof body.inferenceEnabled !== 'boolean' || typeof body.revoked !== 'boolean')
            throw Error('Invalid grant');
        const db = adminClient();
        const { data: device, error } = await db.from('devices').select('id').eq('id', body.deviceId).eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId).eq('purpose', 'mobile').is('revoked_at', null).maybeSingle();
        if (error || !device)
            throw Error('Device unavailable');
        if (!((await loadRoster(ctx.supabase, ctx.workspaceId)).some(r => r.key === body.agentKey)))
            throw Error('Unknown agent');
        if (body.projectId && !(await projectInWorkspace(ctx, body.projectId)))
            throw Error('Project unavailable');
        if (body.inferenceEnabled === true)
            throw Error('Gateway cost enforcement and approval flow not configured');
        const known = await repoKeys();
        if (body.repoKeys.some((r: unknown) => typeof r !== 'string' || !known.includes(r)))
            throw Error('Unknown repository');
        const { error: e } = await db.from('mobile_grants').upsert({ device_id: body.deviceId, owner_id: ctx.userId, workspace_id: ctx.workspaceId, project_id: body.projectId ?? null, agent_key: body.agentKey, repo_keys: [...new Set(body.repoKeys)], inference_enabled: body.inferenceEnabled, revoked_at: body.revoked ? new Date().toISOString() : null });
        if (e)
            throw e;
        return NextResponse.json({ saved: true });
    }
    catch {
        return NextResponse.json({ error: 'Grant not saved' }, { status: 400 });
    }
}
