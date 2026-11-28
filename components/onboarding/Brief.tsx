import type { StepKey } from "@/lib/onboarding-spec"

export type BriefEntry = {
  step: StepKey
  label: string
  value: string | null
  skipped?: boolean
  fixed?: boolean
}

export function Brief({ goal, entries, current, order, ready, onEdit }: {
  goal: string
  entries: BriefEntry[]
  current: StepKey
  order: StepKey[]
  ready: boolean
  onEdit?: (step: StepKey) => void
}) {
  const headline = (
    <span key={goal} className="ob-value">
      {goal || "Your venture, in one sentence"}
      {!goal && current === "goal" && <span className="ob-caret" aria-hidden />}
    </span>
  )

  return (
    <section className="ob-brief" aria-label="Venture brief">
      <header className="ob-brief-header">
        <span>chief-of-staff / brief</span>
        <span className="ob-status" data-ready={ready}>{ready ? "Ready" : "Draft"}</span>
      </header>
      <h2 className="ob-headline" data-empty={!goal}>
        {onEdit ? (
          <button type="button" onClick={() => onEdit("goal")}>
            {headline}<span className="ob-edit" aria-hidden>Edit</span><span className="sr-only"> (edit goal)</span>
          </button>
        ) : headline}
      </h2>
      <div className="ob-brief-rows">
        {entries.map(({ step, label, value, skipped, fixed }) => {
          const reached = ready || fixed || order.indexOf(step) <= order.indexOf(current)
          const state = current === step ? "active" : !reached ? "pending" : skipped ? "skipped" : value ? "answered" : "pending"
          const text = !reached ? "—" : skipped ? "Agent decides" : value || "—"
          const content = (
            <>
              <span className="ob-brief-label">{label}</span>
              <span className="ob-value" key={text} data-muted={text === "—" || Boolean(skipped)} data-skipped={Boolean(reached && skipped)}>{text}</span>
            </>
          )
          return onEdit && !fixed ? (
            <button key={step} type="button" className="ob-brief-row" data-state={state} onClick={() => onEdit(step)}>
              {content}<span className="ob-edit" aria-hidden>Edit</span><span className="sr-only"> (edit)</span>
            </button>
          ) : (
            <div key={step} className="ob-brief-row" data-state={state}>{content}</div>
          )
        })}
      </div>
    </section>
  )
}
