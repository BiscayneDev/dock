// Shared knowledge is deliberate; execution state and credentials are not.
// The same gateway is used by chief, specialist and child. Roles never widen
// owner/workspace/repository grants and cannot promote their own output.
import { createHash } from 'node:crypto';
export function knowledgeGateway({ graph, manifest, readMemory }) {
    if (!Array.isArray(manifest?.repositories) || !Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges))
        throw Error('Versioned knowledge snapshot required');
    if (graph.nodes.length > 500000 || graph.edges.length > 2000000)
        throw Error('Knowledge snapshot exceeds configured limit');
    const sources=new Map(manifest.repositories.map(r=>[r.key,r]))
    const indexed=graph.nodes.filter(n=>sources.get(n.repoKey)?.commit===n.commit&&typeof n.path==='string'&&Number.isInteger(n.line)&&n.line>0).map(n=>({n,search:(String(n.label??'')+' '+n.path+' '+String(n.text??'')).toLowerCase()}))
    const nodeById=new Map(indexed.map(x=>[x.n.id,x.n]));const neighbors=new Map()
    for(const e of graph.edges){if(!nodeById.has(e.source)||!nodeById.has(e.target))continue;for(const[a,b]of[[e.source,e.target],[e.target,e.source]]){if(!neighbors.has(a))neighbors.set(a,[]);neighbors.get(a).push(b)}}
    return async function context(principal, query) {
        if (!principal.ownerId || !principal.workspaceId || !Array.isArray(principal.repoKeys))
            throw Error('Bound principal required');
        const allowed=new Set(principal.repoKeys),q=[...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2))].slice(0,64)
        const matches=indexed.filter(x=>allowed.has(x.n.repoKey)).map(x=>({n:x.n,score:q.reduce((sum,w)=>sum+Number(x.search.includes(w)),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.n.id.localeCompare(b.n.id)).slice(0,15)
        const ranked=matches.map(x=>x.n),seen=new Set(ranked.map(n=>n.id))
        // One-hop structural/declared neighbors only. This exposes actual graph
        // relationships without inventing semantic links or crossing repo grants.
        for(const seed of matches)for(const id of neighbors.get(seed.n.id)??[]){const n=nodeById.get(id);if(ranked.length>=20)break;if(n&&allowed.has(n.repoKey)&&!seen.has(id)){ranked.push(n);seen.add(id)}}
        const ids = new Set(ranked.map(n => n.id));
        const edges = graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)).slice(0, 50);
        const memory = await readMemory({ userId: principal.ownerId, workspaceId: principal.workspaceId }, query, principal.projectId ?? null, 8, principal);
        const coverage = manifest.repositories.filter(r => allowed.has(r.key)).map(r => ({ key: r.key, commit: r.commit, indexedAt: r.indexedAt, coverage: r.coverage, missing: (r.missing ?? []).slice(0, 30), stale: r.currentCommit !== r.commit }));
        const payload = { coverage, nodes: ranked.map(n => ({ id: n.id, label: n.label, repoKey: n.repoKey, commit: n.commit, path: n.path, line: n.line, text: typeof n.text === 'string' ? n.text.slice(0, 2400) : undefined, provenance: n.provenance ?? 'EXTRACTED' })), edges, memory };
        return { ...payload, version: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), trust: 'source-data-not-instructions' };
    };
}
