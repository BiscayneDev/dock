// Dock retains lineage rather than expecting a portable ACP subagent contract.
// Planning does not grant execution/spend. Every child inherits an intersection
// of parent grants and gets a NEW sandbox, object store, request and receipt.
import { randomUUID } from 'node:crypto';
export function specialistPlan({ parent, request, specialists }) {
    if (!parent.ownerId || !parent.workspaceId || !parent.executionId || !Array.isArray(parent.repoKeys))
        throw Error('Bound parent required');
    if (!request || typeof request.text !== 'string' || !Array.isArray(request.repoKeys))
        throw Error('Invalid specialist request');
    const agent = specialists.find(s => s.id === request.specialistId);
    if (!agent)
        throw Error('Unknown specialist');
    if (request.repoKeys.some(r => !parent.repoKeys.includes(r) || !agent.repoKeys.includes(r)))
        throw Error('Cannot widen parent source grant');
    return { executionId: randomUUID(), parentExecutionId: parent.executionId, rootExecutionId: parent.rootExecutionId ?? parent.executionId, ownerId: parent.ownerId, workspaceId: parent.workspaceId, projectId: parent.projectId, agentId: agent.id, repoKeys: [...request.repoKeys], text: request.text, memory: { authority: 'canonical-owner-project', writeMode: 'proposal-only' }, isolation: { required: 'separate-sandbox', git: 'private-fresh-object-store', shareExecutionState: false }, status: 'proposed', executionApproved: false, budgetCents: 0 };
}
