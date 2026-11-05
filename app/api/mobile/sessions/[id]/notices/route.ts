import { NextResponse } from 'next/server';
import { mobileBackend, validateId } from '@/lib/mobile/backend';
export const runtime = 'nodejs';
// Durable inbox, not a claim of mobile push delivery. T3 Connect publishes
// native completion notifications for the ACP conversation independently.
export async function GET(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { try {
    const { id } = await params;
    validateId(id);
    const { store } = await mobileBackend(request);
    return NextResponse.json({ notices: await store.notices(id) });
}
catch {
    return NextResponse.json({ error: 'Mobile notices unavailable' }, { status: 403 });
} }
