import { NextResponse } from 'next/server';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: {
    params: Promise<{
        id: string;
        requestId: string;
    }>;
}) { try {
    const { id, requestId } = await params;
    validateId(id);
    validateId(requestId);
    const { store } = await mobileBackend(request);
    const state = await store.turnStatus(id, requestId);
    return NextResponse.json(state ?? { status: 'unknown' });
}
catch {
    return NextResponse.json({ error: 'Mobile turn unavailable' }, { status: 403 });
} }
