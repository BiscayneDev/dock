// Independent controller process. It needs no create/inference authority and
// never deletes the retained phone host. Store is durable source of deadlines.
export function executionCleanup({ store, controller, retainedInstanceIds, clock = Date.now }) {
    if(!Array.isArray(retainedInstanceIds)||!retainedInstanceIds.length||retainedInstanceIds.some(x=>typeof x!=='string'||!x))throw Error('Explicit retained-instance protection required');
    const retained = new Set(retainedInstanceIds);
    return async function sweep() {
        let deleted = 0, unresolved = 0;
        for (const job of await store.cleanupDue(new Date(clock()).toISOString(), 100)) {
            if (!job.lifecycleApproved || !job.executionId || !job.instanceId || retained.has(job.instanceId)) {
                await store.cleanupBlocked(job.id, 'Missing lifecycle authority or retained instance');
                unresolved++;
                continue;
            }
            if (!await store.claimCleanup(job.id))
                continue;
            try {
                const live = await controller.inspect(job.instanceId);
                // Missing means already deleted only if the owning adapter has
                // explicitly verified a real 404, not timeout/empty parse.
                if (live !== null && live.metadata?.dock_execution_id !== job.executionId)
                    throw Error('Ownership mismatch');
                if (live !== null) {
                    await store.deleteIntent(job.id);
                    await controller.deleteApproved(job.instanceId);
                }
                const after = await controller.inspect(job.instanceId);
                if (after !== null)
                    throw Error('Deletion not confirmed');
                await store.cleanupConfirmed(job.id, new Date(clock()).toISOString());
                deleted++;
            }
            catch {
                await store.cleanupRetry(job.id, 'Deletion or settlement uncertain; inspect same instance, never create replacement');
                unresolved++;
            }
        }
        return { deleted, unresolved };
    };
}
