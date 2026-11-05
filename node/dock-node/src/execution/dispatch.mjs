// A backend capability, never reachable directly from an ACP model/tool call.
// verifyApproval reads a durable owner decision, verifySandbox reads controller
// inventory/inspection. Neither trusts fields supplied by the model or worker.
export function isolatedDispatcher({ verifyApproval, store, controller, source, context }) {
    return async function dispatch(proposalId) {
        const approval = await verifyApproval(proposalId);
        if (!approval?.approved || !approval.ownerId || !approval.workspaceId || !approval.executionId || !/^[a-f0-9]{40}$/.test(approval.sourceCommit??'') || !Number.isSafeInteger(approval.totalBudgetCents*10000) || approval.totalBudgetCents < 0 || approval.computeLifecycleApproved!==true || !Number.isInteger(approval.maxComputeCostMicros) || approval.maxComputeCostMicros<=0 || !approval.cleanupDeadline || !Number.isFinite(Date.parse(approval.cleanupDeadline)) || Date.parse(approval.cleanupDeadline) <= Date.now())
            throw Error('Current exact owner approval required');
        if(typeof controller.assertReady!=='function')throw Error('Controller readiness preflight required');
        await controller.assertReady(approval);
        const claimed = await store.claimExecution(approval);
        if (claimed.status !== 'claimed')
            return claimed;
        // Persist intended identity BEFORE chargeable create; uncertain result is a
        // reconciliation state, never an automatic second sandbox purchase.
        await store.provisionIntent(approval);
        let instance;
        try {
            instance = await controller.createPrivate({ executionId: approval.executionId, budgetCents: approval.totalBudgetCents, cleanupDeadline: approval.cleanupDeadline });
            await store.bindInstance(approval, instance.id);
            const boundary = await controller.inspectIsolation(instance.id,{executionId:approval.executionId,managedBudgetMicros:approval.totalBudgetCents*10000});
            if (boundary.instanceId !== instance.id || boundary.executionId !== approval.executionId || boundary.sharedMounts !== false || boundary.controllerCredentialsPresent !== false || boundary.unprivilegedWorkload !== true || !boundary.enforcedByController)
                throw Error('Independent isolation not established');
            const snapshot = await source(approval);
            if (snapshot.sha !== approval.sourceCommit)
                throw Error('Approved source mismatch');
            const shared = await context({ ownerId: approval.ownerId, workspaceId: approval.workspaceId, projectId: approval.projectId, repoKeys: approval.repoKeys }, approval.text);
            // Controller alone places committed source + shared knowledge into sandbox.
            // No management key, parent scratch state, sibling git data or owner token.
            await controller.prepare({ instanceId: instance.id, snapshot, shared, executionId: approval.executionId });
            await store.startIntent(approval);
            const run = await controller.start({ instanceId: instance.id, agentId: approval.agentId, text: approval.text, executionId: approval.executionId });
            await store.running(approval, run);
            return { status: 'running', executionId: approval.executionId };
        }
        catch (error) {
            await store.reconcileRequired(approval, { instanceId: instance?.id ?? null, reason: 'Provision/start uncertain or refused. Inspect persisted intent before retry.' });
            throw error;
        }
    };
}
