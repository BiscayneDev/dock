import puppeteer from "puppeteer-core"

const CODE = process.argv[2]
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-web-security", "--window-size=390,844"],
  defaultViewport: { width: 390, height: 844 },
})
const page = await browser.newPage()
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 160)) })
await page.goto("http://127.0.0.1:8899/", { waitUntil: "networkidle0", timeout: 30000 })
await page.screenshot({ path: "/downloads/e2e-1-connect.png" })

// Fill Dock URL + pairing code and connect (REAL exchange against the local API)
const inputs = await page.$$("input")
await inputs[0].type("http://127.0.0.1:3100")
await inputs[1].type(CODE)
const clicked = await page.evaluate(() => {
  const els = [...document.querySelectorAll("div,button")]
  const b = els.find((e) => e.textContent === "Connect" && e.children.length === 0)
  if (b) { b.click(); return true } return false
})
console.log("connect clicked:", clicked)
await new Promise((r) => setTimeout(r, 6000))
await page.screenshot({ path: "/downloads/e2e-2-board.png" })

// Open first task
await page.evaluate(() => {
  const els = [...document.querySelectorAll("div")]
  const t = els.find((e) => e.children.length === 0 && /Reconcile|Monitor|Draft|Weekly|Ledger/i.test(e.textContent ?? ""))
  if (t) t.click()
})
await new Promise((r) => setTimeout(r, 3000))
await page.screenshot({ path: "/downloads/e2e-3-task.png" })
await page.goBack().catch(() => null)
await page.goto("http://127.0.0.1:8899/", { waitUntil: "networkidle0" }).catch(() => null)
await new Promise((r) => setTimeout(r, 3000))

// Approvals tab
await page.evaluate(() => {
  const els = [...document.querySelectorAll("div,button")]
  const t = els.find((e) => e.children.length === 0 && /^Approvals/.test(e.textContent ?? ""))
  if (t) t.click()
})
await new Promise((r) => setTimeout(r, 3000))
await page.screenshot({ path: "/downloads/e2e-4-approvals.png" })

// Approve the parked run
await page.evaluate(() => {
  const els = [...document.querySelectorAll("div,button")]
  const b = els.find((e) => e.children.length === 0 && e.textContent === "Approve")
  if (b) b.click()
})
await new Promise((r) => setTimeout(r, 3000))
await page.screenshot({ path: "/downloads/e2e-5-approved.png" })
console.log("done")
await browser.close()
