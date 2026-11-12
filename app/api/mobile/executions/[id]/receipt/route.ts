import { NextResponse } from 'next/server';
import { createPrivateKey } from 'node:crypto';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
import { adminClient } from '@/lib/tenancy';
import { issueExecutionReceipt } from '../../../../../../node/dock-node/src/mobile/receipt-issuer.mjs';
export const runtime = 'nodejs';
// Undeployed draft. Off unless MOBILE_RECEIPT_SIGNING_KEY (PEM) is set server-side.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { try {
    const { id } = await params;
    validateId(id);
    const pem = process.env.MOBILE_RECEIPT_SIGNING_KEY;
    if (!pem) throw Error('not configured');
    const { principal } = await mobileBackend(request);
    const db = adminClient();
    const readExecution = async (executionId: string) => {
        const { data: e, error } = await db.from('mobile_executions').select('id,owner_id,workspace_id,proposal_id,instance_id,run_id,result,result_recorded_at,last_operational_state').eq('id', executionId).eq('owner_id', principal.ownerId).eq('workspace_id', principal.workspaceId).maybeSingle();
        if (error || !e) return null;
        const { data: p } = await db.from('mobile_task_proposals').select('session_id').eq('id', e.proposal_id).eq('owner_id', principal.ownerId).maybeSingle();
        if (!p) return null;
        return { ownerId: e.owner_id, workspaceId: e.workspace_id, sessionId: p.session_id, instanceId: e.instance_id, runId: e.run_id, result: e.result, resultRecordedAt: e.result_recorded_at, success: e.last_operational_state === 'complete' };
    };
    return NextResponse.json(await issueExecutionReceipt({ principal, executionId: id, readExecution, privateKey: createPrivateKey(pem) }));
}
catch {
    return NextResponse.json({ error: 'Receipt unavailable' }, { status: 403 });
} }
