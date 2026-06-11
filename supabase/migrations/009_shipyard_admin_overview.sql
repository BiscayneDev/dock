-- Operator overview for the Shipyard Inference admin dashboard: revenue vs
-- provider cost (margin), settlement collection, per-model/per-user breakdowns,
-- and recent settlements. Read via the service-role client behind admin auth.
create or replace function shipyard_admin_overview()
returns json
language sql
stable
as $$
  select json_build_object(
    'totals', (
      select json_build_object(
        'requests', count(*),
        'providerCostUsd', coalesce(sum(actual_cost_usd), 0),   -- what Shipyard owes upstreams
        'revenueUsd', coalesce(sum(charged_usd), 0),            -- billed to users
        'baselineUsd', coalesce(sum(baseline_cost_usd), 0),
        'marginUsd', coalesce(sum(charged_usd), 0) - coalesce(sum(actual_cost_usd), 0),
        'userSavedUsd', coalesce(sum(baseline_cost_usd), 0) - coalesce(sum(charged_usd), 0)
      ) from inference_usage
    ),
    'settlement', (
      select json_build_object(
        'settledUsd', coalesce((select sum(owed_usd) from inference_settlements where status = 'settled'), 0),
        'settledCount', (select count(*) from inference_settlements where status = 'settled'),
        'pendingUsd', coalesce((
          select sum(charged_usd) from inference_usage
          where settlement_id is null and charged_usd is not null
        ), 0),
        'inflightCount', (select count(*) from inference_settlements where status = 'pending'),
        'failedCount', (select count(*) from inference_settlements where status = 'failed')
      )
    ),
    'byModel', (
      select coalesce(json_agg(m), '[]'::json) from (
        select
          coalesce(model, 'unknown') as model,
          count(*) as requests,
          coalesce(sum(actual_cost_usd), 0) as "providerCostUsd",
          coalesce(sum(charged_usd), 0) as "revenueUsd",
          coalesce(sum(charged_usd), 0) - coalesce(sum(actual_cost_usd), 0) as "marginUsd"
        from inference_usage
        group by model
        order by sum(actual_cost_usd) desc nulls last
      ) m
    ),
    'topUsers', (
      select coalesce(json_agg(t), '[]'::json) from (
        select
          u.id as "userId",
          u.name,
          count(iu.id) as requests,
          coalesce(sum(iu.charged_usd), 0) as "revenueUsd",
          coalesce(sum(iu.actual_cost_usd), 0) as "providerCostUsd",
          coalesce(sum(iu.charged_usd), 0) - coalesce(sum(iu.actual_cost_usd), 0) as "marginUsd",
          coalesce(sum(iu.charged_usd) filter (where iu.settlement_id is null), 0) as "outstandingUsd"
        from inference_usage iu
        join users u on u.id = iu.user_id
        group by u.id, u.name
        order by sum(iu.charged_usd) desc nulls last
        limit 25
      ) t
    ),
    'recentSettlements', (
      select coalesce(json_agg(s), '[]'::json) from (
        select
          s.id, s.status, s.owed_usd as "owedUsd", s.atomic_usdc as "atomicUsdc",
          s.signature, s.network, s.failure_reason as "failureReason",
          to_char(s.created_at, 'YYYY-MM-DD HH24:MI') as "createdAt",
          u.name
        from inference_settlements s
        left join users u on u.id = s.user_id
        order by s.created_at desc
        limit 20
      ) s
    )
  );
$$;
