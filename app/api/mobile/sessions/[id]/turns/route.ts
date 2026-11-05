import { NextResponse } from 'next/server';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { try {
    const { id } = await params;
    validateId(id);
    const { service, principal } = await mobileBackend(request);
    const body = await request.json();
    validateId(body.requestId);
    if (body.sessionId !== id || typeof body.text !== 'string' || body.text.length > 32000)
        throw Error('Invalid turn');
    return NextResponse.json(await service.turn(principal, body, request.signal));
}
catch {
    return NextResponse.json({ error: 'Mobile turn unavailable; do not automatically replay' }, { status: 409 });
} }
