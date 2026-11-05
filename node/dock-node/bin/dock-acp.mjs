#!/usr/bin/env node
import { transportJournal } from '../src/mobile/journal.mjs';
import { createInterface } from 'node:readline';
import { createDockAcp, dockMobileClient } from '../src/mobile/acp.mjs';
// Device-scoped token supplied by normal Dock pairing. Never workspace/admin keys.
if (!process.env.DOCK_URL || !process.env.DOCK_DEVICE_TOKEN) {
    console.error('Dock pairing required');
    process.exit(1);
}
const emit = x => process.stdout.write(JSON.stringify(x) + '\n');
const acp = createDockAcp({ dock: dockMobileClient({ url: process.env.DOCK_URL, token: process.env.DOCK_DEVICE_TOKEN }), emit, journal: process.env.DOCK_ACP_JOURNAL ? transportJournal(process.env.DOCK_ACP_JOURNAL) : undefined });
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
    if (line.length > 100000) {
        console.error('Oversized ACP request');
        continue;
    }
    let request;
    try {
        request = JSON.parse(line);
    }
    catch {
        emit({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
        continue;
    }
    void acp.handle(request).then(result => { if (request.id !== undefined)
        emit({ jsonrpc: '2.0', id: request.id, result: result ?? null }); }, error => { if (request.id !== undefined)
        emit({ jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32603, message: 'Dock request failed; no automatic retry' } }); });
}
