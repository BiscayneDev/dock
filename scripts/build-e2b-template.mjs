#!/usr/bin/env node
// Builds Dinghy's E2B sandbox template: Python 3.12 + browser-use + Chromium
// already installed, so the first computer_browse in a fresh sandbox skips the
// slow setup.
//
// Usage (needs an E2B account API key; not run by CI):
//   E2B_API_KEY=e2b_... node scripts/build-e2b-template.mjs
// Then set E2B_TEMPLATE=dinghy-computer in the Vercel env and redeploy.
// Rebuild whenever src/lib/computer/bootstrap.py changes.
import { Template, defaultBuildLogger } from 'e2b'

const alias = process.env.E2B_TEMPLATE || 'dinghy-computer'

const template = Template()
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

const info = await Template.build(template, { alias, onBuildLogs: defaultBuildLogger() })
console.log('built template', info.alias ?? alias, info.templateId ?? '')
