'use client';
import { useState } from 'react';
type Props = {
    devices: {
        id: string;
        name: string;
    }[];
    agents: {
        key: string;
        displayName: string;
    }[];
    repositoryKeys: string[];
};
export default function GrantEditor({ devices, agents, repositoryKeys }: Props) {
    const [deviceId, setDevice] = useState(devices[0]?.id ?? ''), [agentKey, setAgent] = useState(agents[0]?.key ?? ''), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
    async function save(revoked: boolean) { setBusy(true); setStatus(''); try {
        const response = await fetch('/api/mobile/grants', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, agentKey, projectId: null, repoKeys: selected, inferenceEnabled: false, revoked }) });
        if (!response.ok)
            throw Error('The grant was not saved.');
        setStatus(revoked ? 'Mobile grant revoked.' : 'Read-only mobile grant saved. Inference and task execution remain off.');
    }
    catch (e) {
        setStatus(e instanceof Error ? e.message : 'The grant was not saved.');
    }
    finally {
        setBusy(false);
    } }
    return <section className="space-y-4 rounded-xl border p-5"><h2 className="text-xl font-semibold">Mobile access</h2><p className="text-sm text-neutral-500">Choose the paired mobile device, agent and repositories it may use. This form never starts a model call, spends money or authorizes a task.</p>{!devices.length ? <p className="text-sm">No mobile-purpose device is paired. Existing home-worker devices are not eligible.</p> : <><label className="block text-sm">Paired device<select className="mt-2 block w-full rounded border bg-neutral-950 p-3" value={deviceId} onChange={e => setDevice(e.target.value)}>{devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="block text-sm">Agent<select className="mt-2 block w-full rounded border bg-neutral-950 p-3" value={agentKey} onChange={e => setAgent(e.target.value)}>{agents.map(a => <option key={a.key} value={a.key}>{a.displayName}</option>)}</select></label><fieldset className="space-y-3"><legend className="mb-3 text-sm">Repository knowledge</legend>{repositoryKeys.map(key => <label key={key} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={selected.includes(key)} onChange={e => setSelected(e.target.checked ? [...selected, key] : selected.filter(k => k !== key))}/>{key}</label>)}</fieldset><p className="text-sm text-neutral-500">Inference is locked off until the gateway has a verified spending limit. Saving this grant does not enable the bridge.</p><div className="flex flex-wrap gap-3"><button className="min-h-11 rounded border px-4 py-2" disabled={busy || !agentKey} onClick={() => save(false)}>Save read-only grant</button><button className="min-h-11 rounded border px-4 py-2" disabled={busy} onClick={() => save(true)}>Revoke mobile access</button></div></>}{status && <p className="text-sm" role="status">{status}</p>}</section>;
}
