// Host-owned memory with explicit promotion. Task output is a proposal, never
// authority to rewrite shared facts. Private task logs/credentials are excluded.
import { mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
export async function proposeSharedFact(directory, { taskRef, text, sources }) {
 if (!/^task-[a-z0-9-]{1,64}$/.test(taskRef) || typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('invalid fact proposal')
 if (!Array.isArray(sources) || !sources.length || sources.some((s) => !s || typeof s.source !== 'string' || !/^[a-zA-Z0-9_-]+\//.test(s.source) || s.source.includes('..') || !/^[0-9a-f]{40}$/.test(s.commit))) throw new Error('source-linked proposal required')
 await mkdir(directory,{recursive:true,mode:0o700})
 const proposal={id:randomUUID(),taskRef,text,sources,createdAt:new Date().toISOString(),state:'proposed'}
 const f=await open(join(directory,`${proposal.id}.proposal.json`),'wx',0o600)
 try { await f.writeFile(JSON.stringify(proposal)) } finally { await f.close() }
 return proposal.id
}
// This operation belongs only to the host review workflow. It is not exported
// as an agent tool or mounted into a sandbox. Explicit source revalidation is
// required by the caller; approval objects cannot come from task payloads.
export async function promoteSharedFact(directory, proposalId, { sourceVerified, hostReviewer }) {
 if (!sourceVerified || typeof hostReviewer !== 'string' || !hostReviewer.trim()) throw new Error('host source review required')
 if (!/^[0-9a-f-]{36}$/.test(proposalId)) throw new Error('invalid proposal id')
 const proposal=JSON.parse(await readFile(join(directory,`${proposalId}.proposal.json`),'utf8'))
 const record={...proposal,state:'approved',reviewer:hostReviewer,approvedAt:new Date().toISOString()}
 const f=await open(join(directory,`${proposalId}.approved.json`),'wx',0o600)
 try { await f.writeFile(JSON.stringify(record)) } finally { await f.close() }
 return record
}
