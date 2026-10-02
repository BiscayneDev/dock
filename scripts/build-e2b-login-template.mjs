#!/usr/bin/env node
// Builds the E2B template for the live-view login browser ("dinghy-login"):
// Xvfb + x11vnc + noVNC + Chromium + Playwright (client only, used to read
// cookies over CDP). It holds no Dinghy secrets and is only ever driven by the
// user through the live view. The start/capture scripts are uploaded at run
// time by src/lib/browser-sessions/login.ts, so no files are copied here.
//
// Usage (needs an E2B account API key; not run by CI):
//   E2B_API_KEY=e2b_... node scripts/build-e2b-login-template.mjs
// Then set E2B_LOGIN_TEMPLATE=dinghy-login in the Vercel env and redeploy.
import { Template, defaultBuildLogger } from 'e2b'

const alias = process.env.E2B_LOGIN_TEMPLATE || 'dinghy-login'

const template = Template()
  .fromPythonImage('3.12')
  .aptInstall(['xvfb', 'x11-utils', 'x11vnc', 'openbox', 'chromium', 'fonts-liberation', 'fonts-noto-color-emoji', 'git', 'procps', 'net-tools'], {
    // install as root; the default user runs the session
  })
  .gitClone('https://github.com/e2b-dev/noVNC.git', '/opt/noVNC', { branch: 'e2b-desktop', user: 'root' })
  .gitClone('https://github.com/novnc/websockify.git', '/opt/noVNC/utils/websockify', { branch: 'v0.12.0', user: 'root' })
  .runCmd(
    [
      'ln -sf /opt/noVNC/vnc.html /opt/noVNC/index.html',
      'pip install --no-cache-dir playwright',
      'mkdir -p /home/user/.vnc && chown -R user:user /home/user',
    ],
    { user: 'root' }
  )

const info = await Template.build(template, { alias, onBuildLogs: defaultBuildLogger() })
console.log('built template', info.alias ?? alias, info.templateId ?? '')
