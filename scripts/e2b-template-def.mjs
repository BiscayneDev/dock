// Dinghy's E2B sandbox template definition: Python 3.12 + browser-use +
// Chromium already installed, so the first computer_browse in a fresh sandbox
// skips the slow setup. Kept separate from the build script so tests can
// resolve it offline.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Template } from 'e2b'

// The SDK resolves .copy() sources relative to the calling file's directory
// (scripts/), not the cwd or repo root. Pin the file context to the repo root
// so `node scripts/build-e2b-template.mjs` works from anywhere.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function buildTemplateDefinition() {
  return Template({ fileContextPath: REPO_ROOT })
    .fromPythonImage('3.12')
    .copy('src/lib/computer/bootstrap.py', '/tmp/dinghy-bootstrap.py')
    .runCmd(
      [
        // Install as the sandbox's default user's HOME so $HOME/.browser-use-ready
        // (the marker ensureBrowserUse checks) lands where run-time commands look.
        'mkdir -p /home/user',
        'HOME=/home/user python3 /tmp/dinghy-bootstrap.py --setup',
        'cp /tmp/dinghy-bootstrap.py /home/user/.dinghy-bootstrap.py',
        '/home/user/.browser-use-venv/bin/playwright install-deps chromium',
        'chown -R user:user /home/user',
      ],
      { user: 'root' }
    )
}
