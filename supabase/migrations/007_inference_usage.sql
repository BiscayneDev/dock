-- Per-request inference usage + savings telemetry.
-- Written fire-and-forget by the shipyard-inference Router's usage recorder
-- (src/lib/llm/shipyard.ts) on every completed LLM call, and read by the savings
-- dashboard (GET /api/savings). Both paths use the service-role server client,
-- which bypasses RLS — so, like engagement_events (006), we enable RLS with NO
-- policies to lock the table to the service role and close anon-key exposure.
--
-- saved_usd = baseline_cost_usd - actual_cost_usd, where baseline is what the
-- request would have cost on the intended model, direct + uncached. Cost columns
-- are nullable: a request with no priced baseline records usage but no savings
-- claim (kept honest — we never invent savings).
create table inference_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  model text,
  candidate text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  actual_cost_usd numeric(16, 10),
  baseline_cost_usd numeric(16, 10),
  saved_usd numeric(16, 10),
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- Per-user savings aggregation (dashboard) and global time-ordered scans.
create index idx_inference_usage_user_created on inference_usage(user_id, created_at desc);
create index idx_inference_usage_created on inference_usage(created_at desc);

-- Service-role only: no anon/authenticated access. RLS on, zero policies.
alter table inference_usage enable row level security;

-- Savings summary for the dashboard (GET /api/savings): global totals, this
-- user's totals, and this user's per-model breakdown — in one round trip.
-- Called via the service-role client, which bypasses RLS.
create or replace function inference_savings_summary(p_user_id uuid)
returns json
language sql
stable
as $$
  select json_build_object(
    'global', (
      select json_build_object(
        'requests', count(*),
        'actualUsd', coalesce(sum(actual_cost_usd), 0),
        'baselineUsd', coalesce(sum(baseline_cost_usd), 0),
        'savedUsd', coalesce(sum(saved_usd), 0),
        'inputTokens', coalesce(sum(input_tokens), 0),
        'outputTokens', coalesce(sum(output_tokens), 0),
        'cacheReadTokens', coalesce(sum(cache_read_tokens), 0)
      ) from inference_usage
    ),
    'user', (
      select json_build_object(
        'requests', count(*),
        'actualUsd', coalesce(sum(actual_cost_usd), 0),
        'baselineUsd', coalesce(sum(baseline_cost_usd), 0),
        'savedUsd', coalesce(sum(saved_usd), 0),
        'inputTokens', coalesce(sum(input_tokens), 0),
        'outputTokens', coalesce(sum(output_tokens), 0),
        'cacheReadTokens', coalesce(sum(cache_read_tokens), 0)
      ) from inference_usage where user_id = p_user_id
    ),
    'byModel', (
      select coalesce(json_agg(m), '[]'::json) from (
        select
          model,
          count(*) as requests,
          coalesce(sum(actual_cost_usd), 0) as "actualUsd",
          coalesce(sum(baseline_cost_usd), 0) as "baselineUsd",
          coalesce(sum(saved_usd), 0) as "savedUsd"
        from inference_usage
        where user_id = p_user_id
        group by model
        order by sum(saved_usd) desc nulls last
      ) m
    )
  );
$$;
