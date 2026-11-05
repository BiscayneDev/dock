import { NextResponse } from 'next/server';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
export const runtime = 'nodejs';
export async function POST(request: Request) { try {
    const { service, principal } = await mobileBackend(request);
    const body = await request.json();
    validateId(body.requestId);
    return NextResponse.json(await service.open(principal, body.requestId));
}
catch {
    return NextResponse.json({ error: 'Mobile session unavailable' }, { status: 403 });
} }
