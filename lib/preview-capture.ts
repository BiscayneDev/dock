import { lookup } from "node:dns/promises"
import type { PreviewDeps } from "@/lib/preview-guard"
import { checkTargetUrl, isPrivateHost, PREVIEW_NAV_TIMEOUT_MS, PREVIEW_VIEWPORT } from "@/lib/preview-guard"

// Server-side page capture for approval previews. Runs inside the cron worker tick (Node runtime, Vercel).
// Browser: @sparticuz/chromium + puppeteer-core (pinned). Locally, PREVIEW_CHROME_PATH points at a system Chrome.
// Guards: every request (including redirects and subresources) is checked against the URL rules and its DNS
// answers. Non-http(s) requests are aborted. Each capture uses a fresh incognito context: no cookies, no storage,
// no credentials. The PNG is for the approver to look at; it never authorises or triggers anything.

const MAX_HTML_BYTES = 512 * 1024

interface RequestLike {
  url(): string
  abort(reason?: string): Promise<void>
  continue(): Promise<void>
}

interface PageLike {
  setViewport(v: { width: number; height: number }): Promise<void>
  setRequestInterception(on: boolean): Promise<void>
  on(event: "request", fn: (req: RequestLike) => void): void
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>
  setContent(html: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>
  screenshot(opts: { type: "png"; fullPage: boolean }): Promise<Uint8Array>
}

interface BrowserLike {
  createBrowserContext(): Promise<{ newPage(): Promise<PageLike>; close(): Promise<void> }>
  close(): Promise<void>
}

export type CaptureTarget = { kind: "url"; url: URL } | { kind: "html"; html: string }

/** Resolves a hostname and reports whether every answer is public. IP literals are checked without DNS. */
export async function hostResolvesPublic(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return false
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return true
  try {
    const answers = await lookup(hostname, { all: true, verbatim: true })
    return answers.length > 0 && answers.every((a) => !isPrivateHost(a.address))
  } catch {
    return false
  }
}

/** Per-request policy. Returns true to let the request proceed. */
export async function allowRequest(rawUrl: string): Promise<boolean> {
  if (rawUrl.startsWith("data:") || rawUrl.startsWith("blob:") || rawUrl === "about:blank") return true
  const check = checkTargetUrl(rawUrl)
  if (!check.ok) return false
  return hostResolvesPublic(check.url.hostname)
}

async function launchBrowser(): Promise<BrowserLike> {
  const puppeteer = (await import("puppeteer-core")).default
  const override = process.env.PREVIEW_CHROME_PATH
  if (override) {
    return (await puppeteer.launch({
      executablePath: override,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    })) as unknown as BrowserLike
  }
  const chromium = (await import("@sparticuz/chromium")).default
  return (await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: PREVIEW_VIEWPORT.width, height: PREVIEW_VIEWPORT.height },
  })) as unknown as BrowserLike
}

/**
 * Renders one target to PNG at 1280x800 (full viewport, not full page). The caller applies the overall budget.
 * Returns a reason instead of throwing so the approval can still be created without a screenshot.
 */
export async function renderPreview(
  target: CaptureTarget,
  deadlineMs: number = PREVIEW_NAV_TIMEOUT_MS,
): Promise<{ ok: true; png: Uint8Array } | { ok: false; reason: "capture_failed" | "capture_timeout" | "capture_unavailable" }> {
  let browser: BrowserLike | null = null
  try {
    browser = await launchBrowser()
  } catch {
    return { ok: false, reason: "capture_unavailable" }
  }
  try {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: PREVIEW_VIEWPORT.width, height: PREVIEW_VIEWPORT.height })
    await page.setRequestInterception(true)
    page.on("request", (req) => {
      allowRequest(req.url())
        .then((ok) => (ok ? req.continue() : req.abort("blockedbyclient")))
        .catch(() => req.abort("failed").catch(() => null))
    })
    const timeout = Math.max(1000, Math.min(PREVIEW_NAV_TIMEOUT_MS, deadlineMs))
    if (target.kind === "url") {
      await page.goto(target.url.toString(), { waitUntil: "load", timeout })
    } else {
      if (Buffer.byteLength(target.html, "utf8") > MAX_HTML_BYTES) return { ok: false, reason: "capture_failed" }
      await page.setContent(target.html, { waitUntil: "load", timeout })
    }
    const png = await page.screenshot({ type: "png", fullPage: false })
    return { ok: true, png }
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    const message = error instanceof Error ? error.message : ""
    const timedOut = /timeout/i.test(name) || /timeout/i.test(message)
    return { ok: false, reason: timedOut ? "capture_timeout" : "capture_failed" }
  } finally {
    await browser?.close().catch(() => null)
  }
}

/** The PreviewDeps.capture implementation used by the worker. */
export const captureUrl: PreviewDeps["capture"] = (url) => renderPreview({ kind: "url", url }, PREVIEW_NAV_TIMEOUT_MS)
