import Link from "next/link"
import { redirect } from "next/navigation"
import { readFile } from "fs/promises"
import { join } from "path"
import { currentUser, sessionClient } from "@/lib/tenancy"
import styles from "./landing.module.css"

interface SetupData {
  completed?: boolean
}

async function isSetupComplete(): Promise<boolean> {
  try {
    const raw = await readFile(join(process.cwd(), "data", "setup.json"), "utf-8")
    const data = JSON.parse(raw) as SetupData
    return data.completed === true
  } catch {
    return false
  }
}

const FEATURES = [
  {
    fig: "FIG. 02",
    title: "The board steers the crew",
    body: (
      <>
        Drag a task to <b>In Progress</b> and the agent picks it up. Done work moves itself. No kickoff
        pings, no status chase.
      </>
    ),
  },
  {
    fig: "FIG. 03",
    title: "No coin moves without the principal",
    body: (
      <>
        Every agent runs on a budget. Anything that spends is gated behind an <b>approval card</b> —
        the meter shows its work before it takes yours.
      </>
    ),
  },
  {
    fig: "FIG. 04",
    title: "A morning brief, not a dashboard",
    body: (
      <>
        One glance: agent status, task summary, project health, intel and inbox. <b>Decisions</b> wait
        in the same line of sight as the work.
      </>
    ),
  },
]

export default async function Home() {
  const setupDone = await isSetupComplete()
  if (!setupDone) {
    redirect("/setup")
  }
  // Signed-in visitors go straight to work; the landing is for the not-yet-aboard.
  const user = await sessionClient()
    .then((c) => currentUser(c))
    .catch(() => null)
  if (user) {
    redirect("/assistant")
  }

  return (
    <div className={styles.wrap}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.brand}>
          ⚓ Dock
        </Link>
        <div className={styles.navLinks}>
          <a
            href="https://github.com/BiscayneDev/dock"
            target="_blank"
            rel="noreferrer"
            className={styles.navLink}
          >
            GitHub
          </a>
          <Link href="/login" className={styles.navLink}>
            Sign in
          </Link>
        </div>
      </nav>

      <header className={styles.hero}>
        <p className={styles.kicker}>
          <span className="dot" />
          Dock — the open-source OS for AI agent teams
        </p>
        <h1 className={styles.headline}>Hire the crew. Keep the log. Set sail.</h1>
        <p className={styles.sub}>
          Dock turns a stack of agent tabs into an operating system: one board, one brief, one bill.
          Your agents work in the open — you decide what ships.
        </p>
        <div className={styles.ctas}>
          <Link href="/login" className={styles.ctaPrimary}>
            Launch Dock
          </Link>
          <a
            href="https://github.com/BiscayneDev/dock"
            target="_blank"
            rel="noreferrer"
            className={styles.ctaGhost}
          >
            Read the manifest
          </a>
        </div>
      </header>

      <figure className={styles.frame} style={{ margin: "0 auto" }}>
        <div className={styles.chromeBar}>
          <span className={styles.dots}>
            <span />
            <span />
            <span />
          </span>
          <span className={styles.chromeLabel}>⚓ dock — harbor crossing</span>
          <span className={styles.live}>
            <span className={styles.liveDot} />
            Live
          </span>
        </div>
        <video
          className={styles.media}
          src="/onboarding-wave.mp4"
          poster="/onboarding-wave-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
        />
        <figcaption className={styles.caption}>
          <span>The principal sees everything the crew does.</span>
          <span>FIG. 01 — The Harbor</span>
        </figcaption>
      </figure>

      <section className={styles.strip}>
        {FEATURES.map((f) => (
          <article key={f.fig} className={styles.panel}>
            <div className={styles.panelBar}>
              <span>Log entry</span>
              <span>{f.fig}</span>
            </div>
            <h2 className={styles.panelTitle}>{f.title}</h2>
            <p className={styles.panelBody}>{f.body}</p>
          </article>
        ))}
      </section>

      <footer className={styles.footer}>
        <span>⚓ Dock</span>
        <span>Chart your own course.</span>
        <a href="https://github.com/BiscayneDev/dock" target="_blank" rel="noreferrer">
          BiscayneDev/dock
        </a>
      </footer>
    </div>
  )
}
