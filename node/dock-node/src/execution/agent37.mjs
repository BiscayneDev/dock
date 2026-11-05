import{readExecutionRunCommand,parseExecutionRunRead,prepareExecutionCommand}from'./commands.mjs';
// Backend-only controller adapter. Disabled by default. No management secret is
// copied into instance commands, source, prompts, ACP or the phone environment.
export function agent37ExecutionController({ apiKey, enabled = false, template, fetchImpl = fetch, prepareCommand=prepareExecutionCommand, launchCommand, inspectCommand, verifyControllerBoundary }) {
    if (!/^dock-t3-[a-z0-9-]+@[1-9][0-9]*$/.test(template ?? ''))
        throw Error('Reviewed immutable template required');
    const id = x => { if (!/^[a-z0-9]{1,64}$/.test(x ?? ''))
        throw Error('Invalid instance'); return x; };
    async function call(path, { method = 'GET', body, exec = false } = {}) {
        if (!enabled || !apiKey)
            throw Error('Controller disabled');
        const response = await fetchImpl((exec ? 'https://sandbox.agent37.app/v1' : 'https://api.agent37.com/v1') + path, { method, headers: { [exec ? 'X-Agent37-Key' : 'Authorization']: exec ? apiKey : 'Bearer ' + apiKey, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(exec ? 60000 : 30000) });
        if (response.status === 404 && method === 'GET')
            return null;
        if (!response.ok)
            throw Error('Controller state uncertain/refused (' + response.status + ')');
        return response.json();
    }
    async function exec(instanceId, command) { if (typeof command !== 'string' || command.includes(apiKey) || command.length > 4 * 1024 * 1024)
        throw Error('Unsafe fixed controller command'); const result = await call('/instances/' + id(instanceId) + '/exec', { method: 'POST', body: { command }, exec: true }); if (result.exit_code !== 0 || result.truncated)
        throw Error('Execution command unverified'); return result.stdout; }
    return {
        async assertReady(){if(!enabled||!apiKey||typeof launchCommand!=='function'||typeof inspectCommand!=='function'||typeof verifyControllerBoundary!=='function')throw Error('Complete reviewed execution controller configuration required before purchase');},
        async createPrivate({ executionId, budgetCents, cleanupDeadline }) {
            if (!/^[a-zA-Z0-9_-]{1,100}$/.test(executionId) || !Number.isInteger(budgetCents) || budgetCents < 0 || !Number.isFinite(Date.parse(cleanupDeadline)) || Date.parse(cleanupDeadline) <= Date.now())
                throw Error('Invalid approved execution');
            // This budget is model credits, NOT a hard compute spending cap.
            // verifyApproval must separately cover compute until cleanupDeadline.
            const result = await call('/instances', { method: 'POST', body: { template, name: 'dock-task-' + executionId, metadata: { dock_execution_id: executionId }, resources: { cpu: 2, memory: 4, disk: 4 }, type: 'default', region: 'us', budget: { monthly_cap_micros: 0, credit_micros: budgetCents * 10000 }, public_ports: [], network:'deny-all', auto_sleep: true, idle_timeout_seconds: 300 } });
            return { id: id(result.id) };
        },
        async inspectIsolation(instanceId,expected) {
            const state = await call('/instances/' + id(instanceId));
            // Never infer isolation from worker output alone. Controller inventory
            // binds this actual instance to execution and shows no public ports.
            if (!state || state.id !== instanceId || !state.metadata?.dock_execution_id || !Array.isArray(state.public_ports) || state.public_ports.length)
                throw Error('Controller inventory binding unavailable');
            if(!expected||expected.executionId!==state.metadata.dock_execution_id||!Number.isSafeInteger(expected.managedBudgetMicros)||expected.managedBudgetMicros<0)throw Error('Approved managed budget required');
            const budget=await call('/instances/'+id(instanceId)+'/budget');
            if(!budget||budget.monthly_cap_micros!==0||budget.monthly_consumed_micros!==0||budget.credit_remaining_micros!==expected.managedBudgetMicros)throw Error('Actual managed budget differs from owner decision');
            if(typeof verifyControllerBoundary!=='function'||!await verifyControllerBoundary({instanceId,template,state}))throw Error('Controller-level boundary evidence required');
            const inspection = JSON.parse(await exec(instanceId, inspectCommand()));
            if (!Number.isInteger(inspection.uid) || inspection.uid <= 0 || inspection.sudoAvailable !== false || inspection.controllerCredentialPresent !== false || inspection.siblingMountFound !== false || inspection.rootPolicyReadOnly !== true)
                throw Error('Sandbox policy not verified');
            return { instanceId, executionId: state.metadata.dock_execution_id, sharedMounts: false, controllerCredentialsPresent: false, unprivilegedWorkload: true, enforcedByController: true, inventoryEvidence: state.id };
        },
        async prepare(input) { const result=JSON.parse(await exec(input.instanceId,await prepareCommand(input)));if(result.prepared!==true||result.sourceCommit!==input.snapshot.sha||result.files!==input.snapshot.files.length)throw Error('Source preparation unverified');return result; },
        async start(input) { const result = JSON.parse(await exec(input.instanceId, await launchCommand(input))); if (!result.runId || !result.threadId)
            throw Error('Launch uncertain'); return result; },
        async findExecution(executionId) { if(!/^[a-zA-Z0-9_-]{1,100}$/.test(executionId))throw Error('Invalid execution'); const inventory=await call('/instances'); if(!Array.isArray(inventory?.data)||inventory.has_more||inventory.next_cursor||inventory.pagination?.has_more)throw Error('Complete controller inventory required'); return inventory.data.filter(x=>x.metadata?.dock_execution_id===executionId&&x.name==='dock-task-'+executionId&&x.status!=='deleted').map(x=>({id:id(x.id)})); },
        async readRun(input) { const state=await call('/instances/'+id(input.instanceId)); if(!state||state.id!==input.instanceId||state.metadata?.dock_execution_id!==input.executionId)throw Error('Controller result execution identity mismatch'); return parseExecutionRunRead(await exec(input.instanceId,readExecutionRunCommand(input)),input); },
        async inspect(instanceId) { return call('/instances/' + id(instanceId)); },
        async deleteApproved(instanceId) { return call('/instances/' + id(instanceId), { method: 'DELETE' }); }
    };
}
