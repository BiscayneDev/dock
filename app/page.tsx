import Link from "next/link"
import { DigitalWave } from "@/components/DigitalWave"
import { redirect } from "next/navigation"
import { currentUser, sessionClient } from "@/lib/tenancy"
import styles from "./landing.module.css"

const FEATURES = [
  {
    fig: "FIG. 02",
    title: "Manage work from one board",
    body: (
      <>
        Drag a task to <b>In Progress</b> and the agent picks it up. Done work moves itself. No kickoff
        pings, no status chase.
      </>
    ),
  },
  {
    fig: "FIG. 03",
    title: "Review spending before it happens",
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
  // Signed-in visitors go straight to work; the landing is for the not-yet-aboard.
  const user = await sessionClient()
    .then((c) => currentUser(c))
    .catch(() => null)
  if (user) {
    redirect("/work")
  }

  return (
    <div className={styles.wrap}>
      <nav className={styles.nav}>
        <Link href="/" className="dock-wordmark">
          <span aria-hidden />Dock
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
        <h1 className={styles.headline}>One workspace for your agent team.</h1>
        <p className={styles.sub}>
          Dock turns a stack of agent tabs into an operating system: one board, one brief, one bill.
          Your agents work in the open — you decide what ships.
        </p>
        <div className={styles.ctas}>
          <Link href="/login" className="dock-action">
            Sign in to Dock
          </Link>
          <a
            href="https://github.com/BiscayneDev/dock"
            target="_blank"
            rel="noreferrer"
            className={styles.ctaGhost}
          >
            View on GitHub
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
        <DigitalWave className={styles.media} />
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
