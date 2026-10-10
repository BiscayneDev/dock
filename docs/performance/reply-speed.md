# Reply speed baseline and first cut

Read-only production metadata sampled October 9, 2026. Window: October 3 onward.

- No rows yet in `dinghy_run_stages`. Do not invent a current stage breakdown.
- 12 reply gateway calls: median 6,322ms, mean 7,201ms, p90 13,216.5ms. Last recorded October 5.
- Six first-reply outbox matches: sending took 400-852ms.
- Time from inbound dedupe to first reply enqueue: 1,832-54,846ms. The short row is an early onboarding reply, so it cannot measure completion.
- Older inference rows have no run ID and are recorded after delivery. Matching by chat and time is only an approximate baseline, not a complete turn trace. It cannot isolate tools, context, cold starts or retries.

SQL editor evidence (private authenticated view):
https://supabase.com/dashboard/project/lrucvslmyrowrfenytes/sql/97f19564-6bc4-4d90-9602-089c17ddb49a

## Verdict

Inference is a major cost; send is not. Model choice stays with Jev. Do not cut capability or memory to chase a shorter reply. First remove independent serial DB/embedding waits, then measure natural traffic before claiming an improvement.

This patch overlaps history/facts/memory, identity/embedding recall, and verified user/token reads. No cache, model change, permission change or migration. Existing fail-closed identity and user checks remain. It adds numeric preflight and gateway/work durations to existing metadata-only stage details.

`preflight_ms` measures handler entry to tool-context loading, excluding network/cold start before handler entry. `gatewayMs` is completed main-loop gateway calls, excluding the separate image-description call. `workMs` includes tool-context setup, tools, gateways, retry, and stage writes. The remaining work time is not strictly tool time. Stage timestamps still include diagnostic writes and the final delivery includes outbox bookkeeping.

Do not make telemetry fire-and-forget without a serverless lifetime guarantee. Its awaited writes are bounded at 750ms. No user test texts or paid model calls were triggered for this patch.

## Metadata-only queries for future natural chats

```sql
select run_id, stage, detail, created_at
from dinghy_run_stages
where created_at >= '2026-10-10T00:00:00Z'
order by created_at desc limit 100;
```

```sql
select source, count(*), round(avg(latency_ms)) mean_ms,
 percentile_cont(.5) within group(order by latency_ms) p50_ms,
 percentile_cont(.9) within group(order by latency_ms) p90_ms
from inference_usage
where created_at >= '2026-10-03T00:00:00Z'
group by source;
```

## Next step

Compare completed naturally occurring runs after deployment, separating onboarding, no-tool, tool and photo replies. If gateway remains dominant, inspect routing/gateway latency with the Shipyard owner rather than pinning a model in Dinghy. Keep source tables restricted and existing 14-day stage retention.
