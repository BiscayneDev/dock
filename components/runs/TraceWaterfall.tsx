"use client"

import { Fragment, useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"
import type { ConversationEvent, ConversationRun, RunModelCall, RunTelemetry } from "@/lib/conversations"

export interface TraceSpan {
  id: string
  label: string
  startMs: number
  // null = started but never completed (shown as open)
  endMs: number | null
  // Set on model-call spans, which carry tokens and cost.
  call?: RunModelCall
}

export interface DerivedTrace {
  rootStart: number
  rootEnd: number
  rootOpen: boolean
  children: TraceSpan[]
}

const START_TYPES = new Set(["activity.started", "message.user"])
const END_TYPES = new Set(["activity.completed", "message.assistant"])

function keyOf(event: ConversationEvent): string {
  const data = event.data ?? {}
  const sub = data.activityId ?? data.taskId ?? ""
  return `${event.agent ?? ""}|${typeof sub === "string" || typeof sub === "number" ? String(sub) : ""}`
}

// Spans come only from real event pairs:
//  - activity.started -> activity.completed, matched by agent + data.activityId/taskId
//  - message.user -> message.assistant (the model reply interval)
// An unmatched start is an open span. Unmatched ends are dropped.
export function deriveTrace(
  run: ConversationRun,
  events: ConversationEvent[],
  nowMs: number,
): DerivedTrace {
  const rootStart = Date.parse(run.startedAt)
  const rootOpen = run.status === "running" && !run.completedAt
  const sorted = events
    .map((event) => ({ event, t: Date.parse(event.timestamp) }))
    .filter((item) => Number.isFinite(item.t))
    .sort((a, b) => a.t - b.t)

  let rootEnd: number
  if (run.completedAt && Number.isFinite(Date.parse(run.completedAt))) {
    rootEnd = Date.parse(run.completedAt)
  } else if (rootOpen) {
    rootEnd = Math.max(nowMs, rootStart)
  } else {
    rootEnd = sorted.length ? sorted[sorted.length - 1].t : rootStart
  }
  if (!Number.isFinite(rootStart)) return { rootStart: rootEnd, rootEnd, rootOpen, children: [] }

  const children: TraceSpan[] = []
  const openByKey = new Map<string, TraceSpan[]>()
  const openReply: TraceSpan[] = []

  for (const { event, t } of sorted) {
    if (event.type === "activity.started") {
      const span: TraceSpan = { id: event.id, label: event.summary, startMs: t, endMs: null }
      children.push(span)
      const key = keyOf(event)
      openByKey.set(key, [...(openByKey.get(key) ?? []), span])
    } else if (event.type === "activity.completed") {
      const key = keyOf(event)
      const queue = openByKey.get(key) ?? []
      const span = queue.shift()
      if (span) span.endMs = t
      openByKey.set(key, queue)
    } else if (event.type === "message.user") {
      const span: TraceSpan = { id: event.id, label: "Model reply", startMs: t, endMs: null }
      children.push(span)
      openReply.push(span)
    } else if (event.type === "message.assistant") {
      const span = openReply.shift()
      if (span) span.endMs = t
    }
  }

  // Clamp spans to the root window for display. Real durations are unchanged.
  for (const span of children) {
    if (span.startMs < rootStart) span.startMs = rootStart
    if (span.endMs !== null && span.endMs > rootEnd) span.endMs = rootEnd
  }

  return { rootStart, rootEnd, rootOpen, children }
}

export function formatTokens(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—"
}

export function formatCost(usd: number | null | undefined): string {
  return typeof usd === "number" && Number.isFinite(usd) ? `$${usd.toFixed(4)}` : "—"
}

/** Model-call spans from recorded telemetry. Clamped to the root window like deriveTrace spans. */
export function callSpans(telemetry: RunTelemetry | undefined, rootStart: number, rootEnd: number): TraceSpan[] {
  if (!telemetry) return []
  const spans: TraceSpan[] = []
  for (const call of telemetry.calls) {
    const start = call.startedAt ? Date.parse(call.startedAt) : NaN
    if (!Number.isFinite(start)) continue
    const end = call.endedAt ? Date.parse(call.endedAt) : NaN
    spans.push({
      id: `call-${call.index}`,
      label: `Call ${call.index + 1}${call.model ? ` · ${call.model}` : ""}`,
      startMs: Math.max(start, rootStart),
      endMs: Number.isFinite(end) ? Math.min(end, rootEnd) : null,
      call,
    })
  }
  return spans
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s - m * 60)}s`
}

function telemetryLine(t: RunTelemetry): string {
  return `${formatTokens(t.inputTokens)} in · ${formatTokens(t.outputTokens)} out · ${formatCost(t.costUsd)}`
}

function callLine(c: RunModelCall): string {
  return `${formatTokens(c.inputTokens)} in · ${formatTokens(c.outputTokens)} out · ${formatCost(c.costUsd)}`
}

export function TraceWaterfall({
  run,
  events,
}: {
  run: ConversationRun
  events: ConversationEvent[]
}) {
  const isRunning = run.status === "running" && !run.completedAt
  const [now, setNow] = useState(() => Date.now())
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const trace = deriveTrace(run, events, now)
  // Recorded model calls replace the inferred "Model reply" interval.
  const calls = callSpans(run.telemetry, trace.rootStart, trace.rootEnd)
  if (calls.length > 0) {
    trace.children = [...trace.children.filter((c) => c.label !== "Model reply"), ...calls]
  }
  const telemetry = run.telemetry
  const hasCost = typeof telemetry?.costUsd === "number"
  const total = Math.max(trace.rootEnd - trace.rootStart, 1)
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - trace.rootStart) / total) * 100))

  const completed = trace.children.filter((c) => c.endMs !== null)
  const slowest =
    completed.length >= 2
      ? completed.reduce((best, c) => ((c.endMs! - c.startMs) > (best.endMs! - best.startMs) ? c : best))
      : null

  const rootDuration = trace.rootEnd - trace.rootStart
  const failed = run.status === "failed"
  const barColor = failed ? "rgba(248,113,113,0.55)" : "rgba(124,58,237,0.6)"

  return (
    <div className="flex flex-col gap-2 text-[12px]" style={{ color: "var(--ink-2)" }}>
      {!hasCost && (
        <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
          {telemetry
            ? "Tokens recorded; cost not reported for this run."
            : "Timing only; token and cost are not recorded for this run."}
        </p>
      )}

      <div
        className="rounded-[10px] border p-2.5"
        style={{ borderColor: "var(--line)", background: "var(--surface-1)" }}
      >
        <div className="flex items-center gap-2">
          {trace.children.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? "Collapse spans" : "Expand spans"}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/5"
              style={{ color: "var(--ink-3)" }}
            >
              <ChevronRight size={12} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <span className="w-[108px] shrink-0 truncate font-medium sm:w-[180px]" style={{ color: "var(--ink)" }}>
            Run · {run.runtime || run.agent}
          </span>
          <div className="relative h-5 min-w-0 flex-1 rounded" style={{ background: "var(--surface-3)" }}>
            <div
              className="absolute bottom-1 top-1 rounded"
              style={{
                left: "0%",
                width: `${Math.max(pct(trace.rootEnd), 0.5)}%`,
                background: barColor,
              }}
            />
          </div>
          <span className="w-[56px] shrink-0 text-right tabular-nums" style={{ color: "var(--ink)" }}>
            {formatDuration(rootDuration)}
            {isRunning ? "…" : ""}
          </span>
        </div>

        {telemetry && (
          <p className="mt-1.5 pl-7 text-[11px] tabular-nums" style={{ color: "var(--ink-3)" }}>
            {telemetryLine(telemetry)}
          </p>
        )}
        {failed && (
          <p
            className="mt-2 whitespace-pre-wrap break-words pl-7 text-[12px]"
            style={{ color: "#f87171" }}
          >
            Failed: {run.error || "No error text was recorded for this run."}
          </p>
        )}
        {isRunning && (
          <p className="mt-2 pl-7 text-[11px]" style={{ color: "var(--ink-3)" }}>
            Running; elapsed time updates live.
          </p>
        )}
        {!isRunning && !failed && trace.children.length === 0 && (
          <p className="mt-2 pl-7 text-[11px]" style={{ color: "var(--ink-3)" }}>
            No child spans were recorded for this run.
          </p>
        )}

        {open &&
          trace.children.map((span) => {
            const end = span.endMs ?? trace.rootEnd
            const left = pct(span.startMs)
            const width = Math.max(pct(end) - left, 0.5)
            const dur = span.endMs !== null ? span.endMs - span.startMs : null
            const isSlowest = slowest !== null && slowest.id === span.id
            return (
              <Fragment key={span.id}>
              <div className="mt-1.5 flex items-center gap-2 pl-7">
                <span className="flex w-[80px] shrink-0 items-center gap-1 sm:w-[152px]">
                  <span className="truncate" style={{ color: "var(--ink-2)" }} title={span.label}>
                    {span.label}
                  </span>
                </span>
                <div className="relative h-4 min-w-0 flex-1 rounded" style={{ background: "var(--surface-3)" }}>
                  <div
                    className="absolute bottom-0.5 top-0.5 rounded"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: span.endMs === null ? "transparent" : isSlowest ? "rgba(245,158,11,0.75)" : "rgba(124,58,237,0.45)",
                      border: span.endMs === null ? "1px dashed var(--ink-3)" : "none",
                    }}
                  />
                </div>
                <span className="flex w-[92px] shrink-0 items-center justify-end gap-1 tabular-nums" style={{ color: "var(--ink-3)" }}>
                  {isSlowest && (
                    <span
                      className="rounded border px-1 text-[10px] leading-4"
                      style={{ borderColor: "#f59e0b", color: "#f59e0b" }}
                    >
                      Slowest
                    </span>
                  )}
                  {dur !== null ? formatDuration(dur) : "open"}
                </span>
              </div>
              {span.call && (
                <p className="pl-[116px] text-[11px] tabular-nums sm:pl-[188px]" style={{ color: "var(--ink-3)" }}>
                  {callLine(span.call)}
                </p>
              )}
              </Fragment>
            )
          })}
      </div>
    </div>
  )
}
