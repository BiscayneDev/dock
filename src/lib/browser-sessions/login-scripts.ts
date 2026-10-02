/**
 * Scripts uploaded into the login sandbox at run time (the template only has
 * packages). The sandbox holds no Dinghy secrets; the user drives the browser.
 */

export const LOGIN_DISPLAY = ':99'
export const VNC_PORT = 5900
export const NOVNC_PORT = 6080
export const CDP_PORT = 9222
export const SCREEN = { width: 1024, height: 720 }

/** Shell single-quote escape. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Commands run in order, in the background where noted, to bring up the live view. */
export function loginStartCommands(startUrl: string, vncPassword: string): Array<{ cmd: string; background?: boolean }> {
  const { width, height } = SCREEN
  return [
    { cmd: `Xvfb ${LOGIN_DISPLAY} -ac -screen 0 ${width}x${height}x24 -nolisten tcp`, background: true },
    { cmd: `for i in $(seq 1 40); do xdpyinfo -display ${LOGIN_DISPLAY} >/dev/null 2>&1 && break; sleep 0.25; done` },
    { cmd: `DISPLAY=${LOGIN_DISPLAY} openbox`, background: true },
    { cmd: `mkdir -p "$HOME/.vnc" && x11vnc -storepasswd ${shq(vncPassword)} "$HOME/.vnc/passwd" >/dev/null 2>&1` },
    {
      cmd: `x11vnc -bg -display ${LOGIN_DISPLAY} -forever -shared -wait 50 -rfbport ${VNC_PORT} -rfbauth "$HOME/.vnc/passwd" 2>/tmp/x11vnc.log`,
    },
    {
      cmd:
        `cd /opt/noVNC/utils && ./novnc_proxy --vnc localhost:${VNC_PORT} --listen ${NOVNC_PORT} --web /opt/noVNC > /tmp/novnc.log 2>&1`,
      background: true,
    },
    {
      // --no-sandbox: a throwaway microVM with nothing else in it. CDP stays on loopback.
      cmd:
        `DISPLAY=${LOGIN_DISPLAY} chromium --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check ` +
        `--user-data-dir=/tmp/login-profile --remote-debugging-address=127.0.0.1 --remote-debugging-port=${CDP_PORT} ` +
        `--window-position=0,0 --window-size=${width},${height} --force-device-scale-factor=1 --app=${shq(startUrl)}`,
      background: true,
    },
    { cmd: `for i in $(seq 1 60); do netstat -tuln | grep -q ":${NOVNC_PORT} " && netstat -tuln | grep -q ":${CDP_PORT} " && exit 0; sleep 0.5; done; exit 1` },
  ]
}

/** Reads the browser's cookies and localStorage over CDP and writes a Playwright storage_state file. */
export const CAPTURE_SCRIPT = `import json, sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:${CDP_PORT}")
    if not browser.contexts:
        sys.exit("no browser context")
    state = browser.contexts[0].storage_state()
    with open("/tmp/login-state.json", "w") as f:
        json.dump(state, f)
`

export const CAPTURE_SCRIPT_PATH = '/tmp/login-capture.py'
export const CAPTURE_OUTPUT_PATH = '/tmp/login-state.json'
