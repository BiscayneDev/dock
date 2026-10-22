# Solo Founder Launch Playbook (agent-facing)

Owner: Dock research. Audience: Dock's Chief of Staff and specialist agents (research, go-to-market, engineering, design/brand).
Access date for all sources: 2026-10-21 unless a publication date is given. Source quality is noted; vendor blogs are weaker evidence than primary surveys.

## Summary: the 10 points that matter most

1. The top documented failure cause is building something the market does not need: CB Insights cites "no market need" in 42% of 101 post-mortems. Validate demand before building.
2. Real validation = strangers taking costly actions (time, money, access), not surveys, likes, or waitlist signups.
3. Start with 10–15 problem interviews about the problem, not the product. Then a one-page offer with a concrete call to action, then a paid or concierge pilot.
4. Run out of cash is the #2 cited failure cause (CB Insights). Track runway weekly.
5. Pick one distribution channel and go deep. Founder-led outreach beats paid ads for the first ~100 customers (secondary sources; see gaps).
6. Pricing: usage-based and hybrid models are common and show strong growth/retention in one benchmark (High Alpha 2025, via Orb). Choose the simplest model customers can predict.
7. Retention (NRR/GRR) and CAC payback are the two metrics that decide whether growth is healthy. Median CAC payback reported at 16 months (2025, 342-company study) and 20 months in another roundup; treat ranges, not point values.
8. Sales tax is state-by-state. Economic nexus is commonly $100k in annual sales; 24 states plus DC tax SaaS in some form (TaxCloud, Oct 2026).
9. Crypto checkout (MoonPay Commerce) and x402/USDC are payment rails, not a legal exemption. Stablecoin money-transmission, consumer-protection, and tax questions must go to counsel before launch.
10. Agents should draft, measure, and recommend; the founder decides pricing, legal positions, spend above threshold, and anything that changes customer commitments.

---

## (1) Validate before building

- Failure pattern: CB Insights (2025 report, 101 startup post-mortems) lists "no market need" as #1 (42%), ahead of running out of cash and "not the right team." Source: https://www.cbinsights.com/reports/The-20-Reasons-Startups-Fail.pdf
- Interview sequence (vendor guide, SmolLaunch): 10–15 short problem interviews on frequency, current alternatives, and urgency; then a one-page landing test with a concrete CTA; then a concierge MVP before writing production code. Source: https://smollaunch.com/guides/how-to-validate-startup-idea
- Evidence ladder, weakest to strongest: compliments < signups < calls booked < deposit or pre-order < paid pilot with a success criterion. Vendor guide suggests thresholds such as "5 paid pilots" or "20% of visitors book a call" as examples, not benchmarks (UNVERIFIED as general rules).
- Landing-test funnel rates quoted by SmolLaunch (visit→scroll 40%+, scroll→CTA 10%+, lead→purchase 2%+) are vendor heuristics, UNVERIFIED as market benchmarks.
- Interview rules: interview people who already have the problem; do not pitch; ask about the last time it happened and what they paid to solve it.

**What an agent should do:** draft the interview script and the 5-question problem survey; recruit 10–15 named prospects from the founder's network and public communities; log each interview in a decision log with the verbatim pain quote, current workaround, and any money or time spent; recommend a go/no-go only after the evidence ladder is reached. Do not recommend building past a concierge MVP until at least one stranger has paid or committed.

Sources: CB Insights (above); SmolLaunch guide (above), accessed 2026-10-21.

## (2) First 100 customers: channels and launch sequence

- Practitioner guides consistently say that for early-stage companies, founder-led direct outreach, participation in target communities, and one focused channel work better than paid ads. Sources are practitioner blogs (lower evidence): https://www.gildre.com/guides/first-100-customers and https://entrepreneurbible.net/hubs/first-customers
- Channel order for a small team: (a) direct outreach to a named list of ICP accounts; (b) one community where the ICP already asks questions; (c) partnerships or integrations with tools the ICP already uses; (d) content or SEO only once there is a repeatable message; (e) paid acquisition only after a measured conversion rate exists.
- Sequence: private beta or design partners (5–10) → public launch in one community or directory → weekly case studies from paying users → second channel only after the first produces a repeatable weekly signup count.
- Launch sequencing rule: do not launch broadly until onboarding gets a new user to the first value moment without help (activation), because launch traffic amplifies bad onboarding.

**What an agent should do:** build the ICP list (job title, trigger event, tool stack), draft outreach sequences for a human to send, track one channel metric per week (replies, demos, signups, paid conversions per channel), and propose cutting any channel that has no paid conversion after an agreed number of attempts. Community posts and DMs must be sent or approved by the founder; agents must not impersonate the founder or spam.

## (3) Pricing and packaging (SaaS and services)

- Adoption signal, not a rule: a 2025 High Alpha benchmark, as summarized by Orb, reports 53% of companies monetizing AI use subscription pricing, and hybrid pricing shows 105% median NRR in that cohort. Source: https://www.withorb.com/blog/saas-pricing-strategy-statistics (accessed 2026-10-21). Secondary aggregator; check the primary High Alpha report before quoting.
- Another roundup (Rockingweb, Oct 2026) reports 85% of companies adopting usage-based pricing, which conflicts with other figures and is UNVERIFIED. Source: https://www.rockingweb.com.au/saas-metrics-benchmark-report-2025/
- Trade-offs (practitioner consensus, no single authoritative study): subscriptions are predictable for the founder and customer; usage-based aligns price with value but makes revenue lumpy and bills harder to predict, which hurts small buyers. Services and small SaaS usually start with 2–3 tiers or a flat fee plus a usage cap.
- Free trial and minimum-tier rules are UNVERIFIED as general benchmarks; test them.
- Crypto checkout considerations: MoonPay Commerce says it is used by 6,000+ merchants and offers paylinks, deposits, subscriptions, and checkouts. Fee tables appear in its help pages but the extracted table was ambiguous, so fees are UNVERIFIED; confirm in the merchant dashboard before quoting. Source: https://support.moonpay.com/en/articles/466267-moonpay-commerce-faqs
- Stablecoin prices are volatile in fiat terms only if the merchant holds the asset; prices are normally quoted in USD and settled in USDC. Confirm settlement currency and refund mechanics with the provider.
- x402 (Coinbase) is a per-request HTTP payment flow: the server quotes a price, the client pays, a facilitator verifies and settles. It suits metered API or agent-to-service calls, not typical human subscriptions. Source: https://docs.cdp.coinbase.com/x402/how-it-works (accessed 2026-10-21). Network support for Solana and Base should be checked in current docs before use.

**What an agent should do:** propose two or three packages with explicit limits, a recommended default, and one-line reasons; model the monthly bill for three customer archetypes; flag any usage metric the customer cannot see in advance; list which rails (card, MoonPay Commerce, x402 USDC on Solana/Base) each price supports; never publish prices or refund terms without founder approval.

## (4) Metrics by stage and benchmark ranges

Stage-specific metrics:
- Pre-revenue: interview count, pain evidence count, landing-test conversion, paid pilot count.
- Early (first 100): activation rate (new users reaching first value), weekly new paid customers, trial-to-paid, time-to-first-value.
- Scaling: gross and net revenue retention, CAC, CAC payback, LTV:CAC, monthly burn, runway in months.

Benchmarks (use as context, not targets):
- CAC payback: median 16 months (2025, 342-company Aleph/Benchmarkit study, via Rockingweb). The same Rockingweb article also says 20 months median, which conflicts; cite both and label. Source: https://www.rockingweb.com.au/saas-cac-benchmarks and https://www.rockingweb.com.au/saas-metrics-benchmark-report-2025/
- Net revenue retention: private B2B SaaS median reported at 101–102%; best-in-class 120%+ (Rockingweb, citing SaaS Capital and others). Secondary.
- Retention stability: one 2025 benchmark report puts retention near 90% across ARR bands. Source: https://online.flippingbook.com/view/1018476450/1/ (accessed 2026-10-21); exact definition not confirmed.
- Growth: KeyBanc private SaaS survey (2024, 104 companies, median ARR $26M) shows median ARR growth of 19–21%. Secondary citation; primary is KeyBanc.
- Activation, D30 retention for consumer apps, and small-business churn: UNVERIFIED for Dock's segment. Do not quote a number without a source.
- Runway: commonly reasoned as cash divided by monthly net burn. Thresholds (e.g., "always keep 6 months") are practitioner advice, UNVERIFIED as a benchmark.

**What an agent should do:** set up a weekly dashboard with these metrics for each product; for each metric record the formula, data source, and last-updated time; compare against the founder's own trend first and external benchmarks second; flag when runway drops below an agreed number of months or when NRR falls below 100% for two consecutive periods (the Rockingweb article cites 90% for two quarters as a warning, UNVERIFIED as a rule).

## (5) Common failure modes and early warning signs

- No market need (42% of CB Insights post-mortems): warning sign is praise without payment, interviews that end with "sounds cool."
- Running out of cash (CB Insights #2): warning sign is runway under 6 months with no paid pilot pipeline.
- Pricing and cost issues (CB Insights #5): warning sign is gross margin falling as usage grows, or customers asking for custom discounts on every deal.
- Poor marketing and no channel (CB Insights #8): warning sign is traffic with no conversion after several weeks of work on one channel.
- Ignoring customers (CB Insights #9): warning sign is feature work continuing with no new customer quotes in two weeks.
- Lost focus and too many projects (CB Insights #11, 13% of stories): warning sign is more than two active launch experiments at once.
- Burnout (CB Insights #19, 8% of post-mortems): warning sign is founder work hours rising while the weekly metrics do not move.
- Team and co-founder disharmony (CB Insights #12): warning sign is unresolved disagreement on the decision log for more than two weeks.

**What an agent should do:** keep a risk register with each warning sign, its current status, and a named owner; surface red flags in the weekly review with a specific recommendation; never soften a warning sign because the founder is invested in the idea.

## (6) Operating rhythm for a founder working with agents

- Weekly review (30–60 min, founder-led): last week's metrics, decisions made, open experiments, runway, customer quotes, and one decision for the coming week.
- Decision log: one line per decision with date, decision, reason, evidence link, owner, and reversal trigger. Agents keep the log; founder approves entries that change pricing, scope, or customers.
- Delegate to agents: research and synthesis, drafts of outreach and content, data collection, bug triage, first-pass pricing models, competitive scans, weekly metric pulls.
- Founder decides: pricing and refunds, legal and tax positions, spending above an agreed limit, hiring or contracting, customer commitments, public claims, anything irreversible or external-facing without review.
- Human-in-the-loop for every external message. Agents draft; founder sends or approves.
- Agents should state confidence and source for each recommendation and say "unverified" when they lack a source.

**What an agent should do:** prepare the weekly review packet 24 hours in advance with the metrics, decision log diffs, and top three open questions; mark each item as delegate, decide, or escalate.

## (7) Legal and compliance basics (US) — questions to confirm with counsel

These are questions, not legal advice. Confirm each with a licensed attorney and a tax professional.

Entity and basics:
- Which entity type fits the founder's liability, tax, and fundraising plans (sole prop, LLC, C-corp)? Does the state require registration or a publication step?
- Does the founder need an EIN, a business bank account, and a registered agent?

Sales tax:
- Does the state tax SaaS or digital services? TaxCloud (updated Oct 21, 2026) says 24 states and DC tax SaaS in some form; taxability differs by state and customer type. Source: https://taxcloud.com/blog/saas-sales-tax-by-state/
- Economic nexus is commonly $100,000 in annual sales in most states, with some states at $500,000 (TaxCloud). Confirm current state thresholds before launch.
- Does the founder need a sales-tax permit in each state where nexus exists? Does a remote employee or contractor create physical nexus?

Privacy and terms:
- Does the app collect personal data from California residents? The CCPA applies if gross annual revenue is at least $26.625M (effective Jan 1, 2025), or if the business buys/sells/shares personal information of 100,000+ California residents, or derives 50%+ of revenue from selling/sharing personal information. Source: https://cppa.ca.gov/faq.html (accessed 2026-10-21). A small startup may fall below these thresholds, but confirm.
- Does the business need a privacy policy and terms of service regardless of CCPA? FTC privacy and security guidance is the starting point: https://www.ftc.gov/business-guidance/privacy-security (seen in search, not extracted; confirm).
- Are refunds, cancellations, and auto-renewals disclosed clearly? State auto-renewal laws vary (UNVERIFIED; ask counsel).

Crypto and stablecoin payments (highest-risk area):
- The GENIUS Act (P.L. 119-27, signed July 18, 2025) regulates payment stablecoin issuers; the CRS summary says it does not directly regulate a merchant that accepts stablecoins. Confirm with counsel. Source: https://www.congress.gov/crs-product/R49351 ; OCC implementing rule: https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-50.html (seen in search, not extracted).
- Does accepting USDC via a processor (MoonPay Commerce) or directly via x402 make the business a money transmitter under FinCEN or state law? Ask counsel; do not assume the processor's licence covers Dock's customers.
- Does the business need to hold or transmit customer funds, or only receive payment for its own services? This distinction usually drives money-transmission analysis.
- Are price displays, refunds, and chargebacks compliant when there is no card network dispute process? Ask counsel about consumer-protection disclosures for crypto payments.
- How are crypto receipts taxed and recorded (income at receipt value in USD; cost basis if the business later sells)? Ask a tax professional.
- Does the business need KYC/AML procedures for its customers, and what triggers suspicious-activity reporting?

**What an agent should do:** build a compliance checklist per launch (entity, sales-tax states, privacy, terms, crypto rails) with a status field and "counsel to confirm" flags; never state a legal conclusion as fact; draft questions for counsel from the list above; surface any crypto-payment design change to the founder before shipping.

---

## Gaps and unverified

- UNVERIFIED: the High Alpha primary report figures (cited only via Orb and Rockingweb).
- UNVERIFIED: the 85% usage-based adoption figure (Rockingweb) conflicts with other sources; not used as a fact.
- UNVERIFIED: the 16 vs 20 month CAC payback conflict; both are cited, neither is endorsed.
- UNVERIFIED: MoonPay Commerce fee schedule (extracted table ambiguous).
- UNVERIFIED: landing-page funnel rates and "5 paid pilots" thresholds (vendor heuristics).
- UNVERIFIED: activation and D30 retention benchmarks for Dock's segment; runway thresholds.
- UNVERIFIED: first-100 channel claims rest on practitioner blogs, not controlled studies.
- UNVERIFIED: whether the merchant accepting stablecoins triggers money-transmission or state licensing; flagged for counsel.
- UNVERIFIED: state auto-renewal and consumer-protection rules for crypto payments.
- Not fetched in full: OCC GENIUS bulletin and FTC privacy page (seen in search results only; OCC extraction timed out).
- Not checked: current x402 network support for Solana and Base beyond the Coinbase how-it-works page.
- Freshness: the CB Insights report is undated in the extracted text; TaxCloud was updated Oct 21, 2026; benchmark reports are 2024–2025 data.
