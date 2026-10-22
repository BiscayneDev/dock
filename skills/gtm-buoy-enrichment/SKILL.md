---
name: gtm-buoy-enrichment
description: Use for GTM tasks — prospecting, lead lists, contacts, company research. Buoy tools (Firecrawl People, Context.dev Company Data) are available and priced.
tags:
  - gtm
  - sales
  - prospecting
  - leads
  - enrichment
  - buoy
---

# GTM enrichment via Buoy

For any GTM task — building a target account list, finding decision makers and
their work emails, or researching a company — Buoy has paid tools you can use.
Discover → quote → approve → run: the user sees a per-step cost breakdown and
approves once.

## The two enrichment services

- **Firecrawl People (Alexandria)** (`svc_firecrawl_people`, ~$0.03/call) —
  find people at a company with verified work emails (Apollo, FullEnrich,
  Data Legion behind one Firecrawl key). Upstream request is a POST to
  `api.firecrawl.dev/v2/scrape` with an `alexandria` block:
  `{"provider": "apollo", "capability": "people/search", "options": {...}}`.
  Discovery of tools is free (`/v2/search` with `sources: ["alexandria"]`).
- **Context.dev Company Data** (`svc_context_company`, ~$0.02/call, probed
  live) — structured company profile from any domain: description, industry,
  contacts, stock, headcount. Upstream request is a POST to
  `api.context.dev/v1/brand/retrieve` with `{"type": "by_domain", "domain": "..."}`.

## Workflow

1. **State the request in the quote.** Both are bearer services: the upstream
   request shape is part of the approved quote step's `input`
   (`{method: "POST", body: <JSON>}`) and is frozen at quote time — you cannot
   change it between quote and execution.
2. **Free discovery first.** Buoy discovery is free; enumerate what you need
   before pricing anything. Run the free Apollo person search (via Alexandria
   discovery) before buying work emails for the shortlist.
3. **Quote, approve, run.** Use `buoy_quote` / `buoy_job` / `buoy_settle`.
   Failed calls refund — you are never charged for a step that didn't happen.
4. **Follow provider terms.** People data is for legitimate business purposes
   (B2B sales, recruiting, compliance) — respect GDPR/CAN-SPAM in any outreach.
