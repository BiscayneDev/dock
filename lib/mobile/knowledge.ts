import { readFile, stat } from 'node:fs/promises';
import { recall } from '@/lib/memory';
import{beaconMemory}from'./beacon'
import { knowledgeGateway } from '../../node/dock-node/src/knowledge/context.mjs';
// One immutable snapshot per process, shared by roles. Avoid reparsing the full
// graph for every provider probe/read/status/turn. A changed file invalidates it.
let cached: {
    key: string;
    gateway: ReturnType<typeof knowledgeGateway>;
} | undefined;
let loading: Promise<ReturnType<typeof knowledgeGateway>> | undefined;
export async function canonicalKnowledge() {
    const manifestPath = process.env.DOCK_KNOWLEDGE_MANIFEST, graphPath = process.env.DOCK_KNOWLEDGE_GRAPH;
    if (!manifestPath?.startsWith('/') || !graphPath?.startsWith('/'))
        throw Error('Knowledge snapshot unavailable');
    const [ms, gs] = await Promise.all([stat(manifestPath), stat(graphPath)]);
    if (ms.size > 20 * 1024 * 1024 || gs.size > 100 * 1024 * 1024)
        throw Error('Knowledge snapshot exceeds server limit');
    const key = [manifestPath, graphPath, ms.mtimeMs, gs.mtimeMs, ms.size, gs.size].join(':');
    if (cached?.key === key)
        return cached.gateway;
    if (loading)
        return loading;
    loading = (async () => { const [manifest, graph] = await Promise.all([readFile(manifestPath, 'utf8').then(JSON.parse), readFile(graphPath, 'utf8').then(JSON.parse)]); const gateway = knowledgeGateway({ manifest, graph, readMemory: async(owner:any,query:string,projectId:string|null,limit:number,principal:any)=>process.env.DOCK_BEACON_ENABLED==='true'?beaconMemory().recall({...principal,projectId},query):recall(owner,query,projectId,limit) }); cached = { key, gateway }; return gateway; })();
    try {
        return await loading;
    }
    finally {
        loading = undefined;
    }
}
