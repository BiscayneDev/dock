import { NextResponse } from 'next/server';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
export const runtime = 'nodejs';
// Ack means this device fetched the notice, not push reached a phone.
export async function POST(request: Request, { params }: {
    params: Promise<{
        id: string;
        noticeId: string;
    }>;
}) { try {
    const { id, noticeId } = await params;
    validateId(id);
    validateId(noticeId);
    const { store } = await mobileBackend(request);
    return NextResponse.json({ acknowledged: await store.ackNotice(id, noticeId) });
}
catch {
    return NextResponse.json({ error: 'Notice unavailable' }, { status: 403 });
} }
