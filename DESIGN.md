---
version: alpha
name: Dock
description: A quiet, document-first workspace for directing agent teams.
colors:
  primary: "#EDEDEF"
  canvas: "#0A0A0B"
  panel: "#0E0E10"
  secondary-ink: "#A1A1A8"
  quiet-ink: "#6B6B73"
  hairline: "rgba(255, 255, 255, 0.08)"
  strong-line: "rgba(255, 255, 255, 0.14)"
  selection: "rgba(255, 255, 255, 0.04)"
  ready: "oklch(0.82 0.1 200)"
  white: "#FFFFFF"
typography:
  title:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  brief-headline:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: Geist
    fontSize: 14px
    lineHeight: 1.5
  label:
    fontFamily: Geist Mono
    fontSize: 11px
    lineHeight: 1.5
  action:
    fontFamily: Geist
    fontSize: 13.5px
    fontWeight: 500
rounded:
  control: 8px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.canvas}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    height: 36px
  button-primary-hover:
    backgroundColor: "{colors.white}"
    textColor: "{colors.canvas}"
  brief:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  supporting-copy:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.secondary-ink}"
---

## Overview

Dock should feel like a workstation, not a landing page. The user should be able to tell what needs attention, what will happen next, and what the agent will carry forward. The [onboarding flow](app/onboarding/page.tsx) and [venture brief](components/onboarding/Brief.tsx) are the reference implementation. Apply this direction when building or revising Dock product surfaces; it is not a claim that every legacy screen already matches.

Choose what the surface is for before choosing its layout:

- **Configure** — pair one focused input or decision with the artifact it changes. In onboarding, answers build the brief in place.
- **Decide** — lead with what needs a decision, the evidence, and the action. Use the Inbox for approvals and blockers; don't bury them in a dashboard.
- **Inspect** — lead with the document, list, or timeline. Make rows open the underlying run, source, or next action instead of ending at a summary tile.

## Colors

Use near-black canvas, a slightly lighter panel, and white ink. Reserve the teal accent for a small readiness indicator; always pair it with a text state. Do not use color alone to signal success, errors, selection, or status. Use secondary ink or stronger for readable labels and instructions; quiet ink is for nonessential metadata and empty placeholders, not required text. Hairlines delineate sections, not the sole indicator for an interactive control. Check contrast on the actual backing surface (4.5:1 for normal text, 3:1 for focus indicators and essential control boundaries).

## Typography

Use the existing Geist Sans and Geist Mono fonts (`--font-geist-sans`, `--font-geist-mono`). Keep functional titles at 28–30 px with balanced wrapping, and normal UI text at about 14 px. Use mono for labels, progress, keyboard hints, and technical identifiers, with tabular numerals for counts. Keep headings and actions in sentence case. No display serif in product controls.

## Layout

Left-align questions, actions, values, and documents. On wider screens, a Configure surface can use a `1fr / 1.05fr` split with a working column around 460 px and a hairline-separated artifact pane. Below 1024 px, remove the persistent pane and put the same artifact inline where it is needed for review. Don't duplicate the decision or action on the same screen. Test at 1440×900 and 390×844 with long values, not just ideal fixtures. On mobile, keep the user’s next action easy to find without obscuring the content.

## Elevation & Depth

The digital wave is Dock’s visual signature. Use the landing page’s wave artwork as a framed image beside sign-in and workspace setup on desktop, and as a short still below the form on mobile. Keep controls on a solid surface, never over the image. Use the still on these entry screens so the form stays calm and works without motion. In venture onboarding, the live brief owns the second column; keep wave artwork out of that workspace and day-to-day tools.

Separate layers with spacing, a slightly lighter solid fill, and thin borders. Use motion to explain changes, not as decoration: onboarding steps enter over 260 ms with `cubic-bezier(.22,1,.36,1)` and a 6 px vertical offset; brief values settle over 300 ms. Honor reduced motion for all animations and transitions. A loading indicator must accompany useful status text.

## Shapes

Use 8–10 px corners for controls and modest corners for document panels. Use the small outlined square next to the Dock wordmark. Circles are for affordances that need them (radio indicators, toggles, status dots), not icon medallions.

## Components

- **Actions:** One solid light primary per decision; secondary actions are ghost buttons or text. Use a 2 px visible focus outline with 2 px offset. Keep input rows and touch actions at least 44 px high on touch screens.
- **Choice rows:** Full-width rows with a selection ring, a readable label, and optional plain “Recommended” text. Offer keyboard shortcuts only where they actually work. Typing in a free-text field must not trigger navigation shortcuts.
- **Progress:** Use segmented hairlines and a text step count. Only add steps needed to reach the artifact; make optional work skippable with clear consequences.
- **Briefs:** Use a document header, a headline that captures the user’s intent, and labeled rows. Distinguish current, answered, skipped, and not-yet-reached states. Don't present defaults as answers before the user sees them. Link review edits directly to the affected entry. Keep the result visible during a handoff where practical.
- **Implementation:** The approved Configure styles are scoped under `.ob-root` in `app/globals.css`. Use the tokens in this file as a starting point for migrated surfaces; don't import onboarding selectors into unrelated components or change all legacy styles in one sweep. `docs/design/dock.tokens.json` is the generated DTCG export; regenerate it from this file, not the other way around.

## Do's and Don'ts

- **Do** start with real work; make the user's first input visibly improve the artifact.
- **Do** describe what Dock actually saves, does, or hands off. Use direct terms such as “Review,” “Skip,” and “Agent decides.”
- **Don't** add welcome gates, hero treatments, three-up feature cards, decorative emoji, indigo gradients, glow, blurred glass, accent rails, or oversized metrics to product screens.
- **Don't** use nautical metaphors to explain actions. Dock can have a nautical name without asking users to “set sail.”
- **Before review:** verify keyboard and touch paths, desktop and mobile layouts, reduced motion, and empty/long content. Check that the screen still works when every decorative element is removed.
