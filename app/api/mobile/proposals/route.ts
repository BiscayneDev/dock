import { NextResponse } from 'next/server';
import { assistantContext } from '@/lib/assistant-store';
import { adminClient } from '@/lib/tenancy';
export const runtime = 'nodejs';
export async function GET() { const ctx = await assistantContext(); if (!ctx)
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 }); const { data, error } = await adminClient().from('mobile_task_proposals').select('id,session_id,request_id,proposal,status,created_at').eq('owner_id', ctx.userId).eq('workspace_id', ctx.workspaceId).order('created_at', { ascending: false }).limit(100); if (error)
    return NextResponse.json({ error: 'Proposals unavailable' }, { status: 503 }); return NextResponse.json({ proposals: data, executionEnabled: false }); }
