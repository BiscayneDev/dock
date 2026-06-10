-- Milestone 2: per-user Paybox billing (meter-then-settle).
--
-- The user's accrued inference cost (actual + margin, clamped to never exceed the
-- direct-API baseline) is metered on inference_usage.charged_usd, then settled in
-- USDC from the user's own Paybox wallet to a treasury once it crosses a threshold.
-- Settlement is claim -> settle (on-chain) -> finalize, with a per-user advisory
-- lock so concurrent crons never double-charge. See src/lib/billing/settle.ts.

-- Settlement ledger: one row per on-chain settlement attempt. Service-role only
-- (RLS on, no policies, like inference_usage / engagement_events).
create table inference_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'settled', 'failed')),
  owed_usd numeric(16, 10) not null,   -- sum of charged_usd claimed into this settlement
  atomic_usdc bigint not null,         -- round(owed_usd * 1e6) — the USDC amount transferred
  network text not null,               -- 'devnet' | 'mainnet' — which cluster this settled on
  treasury text not null,              -- treasury address that received the USDC
  signature text,                      -- on-chain tx signature, set on finalize
  payer text,                          -- user wallet debited, set on finalize
  failure_reason text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now()
);
create index idx_inference_settlements_user on inference_settlements(user_id, created_at desc);
create index idx_inference_settlements_pending on inference_settlements(created_at) where status = 'pending';
alter table inference_settlements enable row level security;

-- Billing columns on inference_usage. charged_usd is written by the recorder
-- (src/lib/llm/shipyard.ts); settlement_id/settled_at are managed by the RPCs below.
alter table inference_usage
  add column charged_usd numeric(16, 10),
  add column settlement_id uuid references inference_settlements(id) on delete set null,
  add column settled_at timestamptz;

-- "Unclaimed, billable" rows: the claim/candidate scan predicate.
create index idx_inference_usage_unsettled
  on inference_usage(user_id)
  where settlement_id is null and charged_usd is not null;

-- Claim the user's unsettled balance for settlement. Under a per-user advisory
-- lock (auto-released at COMMIT), sums and stamps the EXACT SAME id set (captured
-- via FOR UPDATE) so a concurrent insert can't skew owed_usd vs the rows claimed.
-- Returns {settlement_id, owed_usd, atomic_usdc} or null when below threshold.
create or replace function claim_settlement(
  p_user_id uuid,
  p_threshold numeric,
  p_network text,
  p_treasury text
) returns json
language plpgsql
as $$
declare
  v_ids uuid[];
  v_owed numeric(16, 10);
  v_atomic bigint;
  v_settlement_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Lock + capture the billable rows; sum over exactly what we locked.
  select array_agg(s.id), coalesce(sum(s.charged_usd), 0)
  into v_ids, v_owed
  from (
    select id, charged_usd
    from inference_usage
    where user_id = p_user_id and settlement_id is null and charged_usd is not null
    for update
  ) s;

  if v_owed < p_threshold then
    return null;
  end if;

  v_atomic := round(v_owed * 1000000);
  if v_atomic <= 0 then
    return null;
  end if;

  insert into inference_settlements (user_id, status, owed_usd, atomic_usdc, network, treasury)
  values (p_user_id, 'pending', v_owed, v_atomic, p_network, p_treasury)
  returning id into v_settlement_id;

  update inference_usage set settlement_id = v_settlement_id where id = any(v_ids);

  return json_build_object(
    'settlement_id', v_settlement_id,
    'owed_usd', v_owed,
    'atomic_usdc', v_atomic::text   -- text so JS doesn't lose bigint precision
  );
end;
$$;

-- Mark a settlement settled after the on-chain transfer confirmed. Status-guarded
-- so a duplicate finalize is a no-op (idempotent).
create or replace function finalize_settlement(
  p_settlement_id uuid,
  p_signature text,
  p_payer text
) returns void
language plpgsql
as $$
begin
  update inference_settlements
  set status = 'settled', signature = p_signature, payer = p_payer,
      settled_at = now(), updated_at = now()
  where id = p_settlement_id and status = 'pending';

  update inference_usage set settled_at = now() where settlement_id = p_settlement_id;
end;
$$;

-- Release a claim when settlement provably failed BEFORE broadcast: rows lose their
-- settlement_id and re-accrue for the next run. NEVER call this for a post-broadcast
-- ambiguous failure (would double-charge) — leave those 'pending' for manual review.
create or replace function void_settlement(
  p_settlement_id uuid,
  p_reason text
) returns void
language plpgsql
as $$
begin
  update inference_usage set settlement_id = null, settled_at = null
  where settlement_id = p_settlement_id;

  update inference_settlements
  set status = 'failed', failure_reason = p_reason, updated_at = now()
  where id = p_settlement_id and status = 'pending';
end;
$$;

-- Users whose unsettled balance is at/over the threshold and who have no recent
-- in-flight settlement (avoids re-touching a user mid-settle across overlapping crons).
create or replace function settle_candidates(p_threshold numeric)
returns table(user_id uuid, owed numeric)
language sql
stable
as $$
  select iu.user_id, sum(iu.charged_usd) as owed
  from inference_usage iu
  where iu.settlement_id is null and iu.charged_usd is not null and iu.user_id is not null
    and not exists (
      select 1 from inference_settlements s
      where s.user_id = iu.user_id and s.status = 'pending'
        and s.created_at > now() - interval '10 minutes'
    )
  group by iu.user_id
  having sum(iu.charged_usd) >= p_threshold;
$$;

-- Extend the savings summary with charged_usd so the dashboard can show the user's
-- REAL out-of-pocket savings (baseline - charged), with actual-vs-charged being margin.
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
        'chargedUsd', coalesce(sum(charged_usd), 0),
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
        'chargedUsd', coalesce(sum(charged_usd), 0),
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
          coalesce(sum(charged_usd), 0) as "chargedUsd",
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
