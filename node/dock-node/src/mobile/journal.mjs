// Transport receipt IDs survive bridge restarts, so an uncertain turn can be
// looked up without sending the prompt again. File contains IDs only, no text.
import { mkdir, appendFile, readFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
export function transportJournal(path) {
    if (!path?.startsWith('/'))
        throw Error('Absolute private journal path required');
    return { async record({ sessionId, requestId, status }) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await appendFile(path, JSON.stringify({ sessionId, requestId, status, at: new Date().toISOString() }) + '\n', { mode: 0o600 }); await chmod(path, 0o600); }, async latest(sessionId) { let text; try {
            text = await readFile(path, 'utf8');
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return null;
            throw e;
        } return text.trim().split('\n').reverse().filter(Boolean).map(x => JSON.parse(x)).find(x => x.sessionId === sessionId) ?? null; } };
}
