import { NextResponse } from 'next/server';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { try {
    const { id } = await params;
    validateId(id);
    const { service, principal } = await mobileBackend(request);
    return NextResponse.json(await service.load(principal, id));
}
catch {
    return NextResponse.json({ error: 'Mobile session unavailable' }, { status: 403 });
} }
