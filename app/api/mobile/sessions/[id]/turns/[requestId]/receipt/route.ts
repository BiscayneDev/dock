import { NextResponse } from 'next/server';
import { createPrivateKey } from 'node:crypto';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
import { issueTurnReceipt } from '../../../../../../../../node/dock-node/src/mobile/receipt-issuer.mjs';
export const runtime = 'nodejs';
// Undeployed draft. Off unless MOBILE_RECEIPT_SIGNING_KEY (PEM) is set server-side; never in a client or task.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) { try {
    const { id, requestId } = await params;
    validateId(id); validateId(requestId);
    const pem = process.env.MOBILE_RECEIPT_SIGNING_KEY;
    if (!pem) throw Error('not configured');
    const { store, principal } = await mobileBackend(request);
    return NextResponse.json(await issueTurnReceipt({ principal, sessionId: id, requestId, store, privateKey: createPrivateKey(pem) }));
}
catch {
    return NextResponse.json({ error: 'Receipt unavailable' }, { status: 403 });
} }
