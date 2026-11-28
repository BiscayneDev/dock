"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// ── Five surfaces (2026-11-24 IA consolidation) ────────────────────────────────
// Inbox and Work are the daily surfaces; Agents, Knowledge and Settings hold the rest.
// Legacy pages (/dashboard, /tasks, /treasury, …) stay live as redirects and deep links —
// nothing a user bookmarked is allowed to 404.

const SURFACES = [
  { href: "/inbox", label: "Inbox", home: "/inbox" },
  { href: "/work", label: "Work", home: "/work" },
  { href: "/agents", label: "Agents", home: "/agents" },
  { href: "/knowledge", label: "Knowledge", home: "/knowledge" },
  { href: "/settings", label: "Settings", home: "/settings" },
] as const;

// Legacy pages each surface absorbed. They stay live (redirect or deep link) and count as
// part of their surface for nav highlighting only.
const LEGACY_PREFIXES: Record<(typeof SURFACES)[number]["href"], string[]> = {
  "/inbox": ["/alerts", "/activity"],
  "/work": ["/dashboard", "/tasks", "/treasury", "/projects", "/intel", "/calendar", "/company"],
  "/agents": ["/skills", "/memory", "/schedules"],
  "/knowledge": [],
  "/settings": ["/costs"],
};

// Bottom nav drops Knowledge (it is reachable from Work and Settings in one click).
const MOBILE_NAV = [
  { href: "/inbox", label: "Inbox" },
  { href: "/work", label: "Work" },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/status")
      .then((r) => r.json())
      .then((d: { payboxWallet?: string }) => {
        if (d.payboxWallet) setWallet(d.payboxWallet);
      })
      .catch(() => null);
  }, []);

  // A surface is active on its own route and on the legacy pages it absorbed.
  const isActive = (href: (typeof SURFACES)[number]["href"]) =>
    pathname === href || LEGACY_PREFIXES[href].some((p) => pathname.startsWith(p));

  return (
    <>
      {/* Desktop rail */}
      <aside
        className="dock-rail hidden shrink-0 flex-col border-r px-3.5 py-5 md:flex"
        style={{
          width: "13rem",
          minHeight: "100vh",
        }}
      >
        <Link href="/work" className="dock-wordmark mb-5 rounded-lg px-2 py-1">
          <span aria-hidden />Dock
        </Link>
        <Link href="/onboarding?mode=venture" className="dock-action mb-4">
          Launch a venture
        </Link>
        <nav aria-label="Workspace" className="flex flex-1 flex-col gap-1">
          <p
            className="px-2.5 pb-1.5 pt-3 text-[9.5px] uppercase tracking-[0.18em]"
            style={{ color: "var(--dock-ink-2)" }}
          >
            Surfaces
          </p>
          {SURFACES.map(({ href, label }) => (
            <RailItem key={href} href={href} label={label} active={isActive(href)} />
          ))}
        </nav>

        {/* Footer: wallet + everything-else hint */}
        <div className="mt-auto border-t pt-3" style={{ borderColor: "var(--line)" }}>
          {wallet ? (
            <div className="px-2.5">
              <p className="flex items-center gap-1.5 font-mono text-[10.5px]" style={{ color: "var(--dock-ink-2)" }}>
                <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-[var(--dock-ready)]" />
                <span className="sr-only">Wallet connected: </span>
                {wallet.length > 12 ? `${wallet.slice(0, 5)}…${wallet.slice(-4)}` : wallet}
              </p>
            </div>
          ) : null}
          <p className="mt-2 px-2.5 font-mono text-[10px]" style={{ color: "var(--dock-ink-2)" }}>
            ⌘K chief · ⌘P commands
          </p>
          <button
            type="button"
            onClick={async () => {
              const { createBrowserClient } = await import("@supabase/ssr")
              const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
              await supabase.auth.signOut()
              window.location.href = "/login"
            }}
            className="mt-2 w-full rounded-[8px] px-2.5 py-1.5 text-left text-[11.5px] hover:bg-white/5"
            style={{ color: "var(--dock-ink-2)" }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Workspace"
        className="dock-rail fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t px-2 py-2 md:hidden"
        style={{
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
        }}
      >
        {MOBILE_NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "location" : undefined}
            className="flex items-center rounded-lg px-3 py-1.5 text-[var(--dock-ink-2)] transition-colors"
          >
            <span className="text-[11px] font-medium">{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

function RailItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "location" : undefined}
      className="flex items-center rounded-lg px-2.5 py-[7px] text-[13px] text-[var(--dock-ink-2)] transition-colors hover:bg-white/5"
    >
      <span className={active ? "font-medium" : ""}>{label}</span>
    </Link>
  );
}
