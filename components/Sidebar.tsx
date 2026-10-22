"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const WORKSPACE = [
  { href: "/assistant", label: "Assistant" },
  { href: "/dashboard", label: "Command Deck" },
  { href: "/tasks", label: "Missions" },
  { href: "/agents", label: "Agents" },
  { href: "/intel", label: "Intel" },
  { href: "/settings", label: "Settings" },
];

const RAILS = [
  { href: "/treasury", label: "Treasury" },
  { href: "/projects", label: "Projects" },
];

const MOBILE_NAV = [
  { href: "/dashboard", label: "Deck" },
  { href: "/tasks", label: "Missions" },
  { href: "/agents", label: "Agents" },
  { href: "/treasury", label: "Rails" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/status")
      .then((r) => r.json())
      .then((d: { payboxWallet?: string }) => {
        if (d.payboxWallet) setWallet(d.payboxWallet);
      })
      .catch(() => null);
  }, []);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <>
      {/* Desktop rail */}
      <aside
        className="hidden md:flex shrink-0 flex-col px-3.5 py-5"
        style={{
          width: "13rem",
          backgroundColor: "var(--surface-0)",
          borderRight: "1px solid var(--line)",
          minHeight: "100vh",
        }}
      >
        {/* Brand */}
        <Link href="/dashboard" className="mb-5 flex items-center gap-2.5 px-2 py-1">
          <span
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] text-[14px]"
            style={{
              background: "linear-gradient(145deg, #a78bfa 0%, #6366f1 55%, #22d3ee 130%)",
              boxShadow: "0 0 24px rgba(139,92,246,.35), inset 0 1px 0 rgba(255,255,255,.25)",
            }}
          >
            ⚓
          </span>
          <span className="font-serif text-[16.5px]">
            Dock
          </span>
        </Link>

        {/* Launch */}
        <button
          onClick={() => router.push("/onboarding?mode=venture")}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] font-semibold transition-all duration-200 hover:-translate-y-[1px]"
          style={{
            color: "#0b0b10",
            background: "linear-gradient(135deg, #d8ccf9, #a78bfa 60%, #8b5cf6)",
            boxShadow: "0 1px 0 rgba(255,255,255,.35) inset, 0 6px 24px rgba(139,92,246,.28)",
          }}
        >
          ✦ Launch a venture
        </button>

        <nav className="flex flex-1 flex-col gap-1">
          <p
            className="px-2.5 pb-1.5 pt-3 text-[9.5px] uppercase tracking-[0.18em]"
            style={{ color: "var(--ink-3)" }}
          >
            Workspace
          </p>
          {WORKSPACE.map(({ href, label }) => (
            <RailItem key={href} href={href} label={label} active={isActive(href)} />
          ))}

          <p
            className="px-2.5 pb-1.5 pt-5 text-[9.5px] uppercase tracking-[0.18em]"
            style={{ color: "var(--ink-3)" }}
          >
            Rails
          </p>
          {RAILS.map(({ href, label }) => (
            <RailItem key={href} href={href} label={label} active={isActive(href)} />
          ))}
        </nav>

        {/* Footer: wallet + everything-else hint */}
        <div className="mt-auto border-t pt-3" style={{ borderColor: "var(--line)" }}>
          {wallet ? (
            <div className="px-2.5">
              <p className="flex items-center gap-1.5 font-mono text-[10.5px]" style={{ color: "var(--ink-2)" }}>
                <span
                  className="h-[5px] w-[5px] rounded-full"
                  style={{ backgroundColor: "#6ee7b7", boxShadow: "0 0 7px #6ee7b7" }}
                />
                {wallet.length > 12 ? `${wallet.slice(0, 5)}…${wallet.slice(-4)}` : wallet}
              </p>
            </div>
          ) : null}
          <p className="mt-2 px-2.5 font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
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
            style={{ color: "var(--ink-3)" }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around px-2 py-2 md:hidden"
        style={{
          backgroundColor: "var(--surface-0)",
          borderTop: "1px solid var(--line)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {MOBILE_NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 transition-colors"
            style={{ color: isActive(href) ? "#ffffff" : "var(--ink-3)" }}
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
      className="relative flex items-center rounded-lg px-2.5 py-[7px] text-[13px] transition-colors"
      style={{
        color: active ? "var(--ink)" : "var(--ink-2)",
        backgroundColor: active ? "rgba(139,92,246,.13)" : "transparent",
      }}
    >
      {active && (
        <span
          className="absolute -left-[14px] top-[20%] h-[60%] w-[1.5px]"
          style={{ background: "linear-gradient(180deg, #a78bfa, transparent)" }}
        />
      )}
      <span className={active ? "font-medium" : ""}>{label}</span>
    </Link>
  );
}
