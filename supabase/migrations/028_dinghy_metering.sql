-- Dinghy metering: one inference_usage row per gateway call on the iMessage
-- path, keyed by chat. Additive only.
--
-- charged_usd stays NULL on these rows on purpose: settle.ts bills rows with
-- charged_usd set to the user's PayBox wallet, and iMessage metering must
-- never move money. user_id also stays NULL so the web app's per-user
-- savings summary is unchanged.

alter table inference_usage
  add column if not exists chat_guid text,
  add column if not exists source text,
  add column if not exists cost_estimated boolean;

create index if not exists inference_usage_chat_guid_created_at
  on inference_usage (chat_guid, created_at)
  where chat_guid is not null;

create or replace function dinghy_record_usage(
  p_chat_guid text,
  p_source text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric,
  p_cost_estimated boolean,
  p_latency_ms integer
) returns void
language sql
security definer
set search_path = public
as $$
  insert into inference_usage
    (chat_guid, source, model, candidate, input_tokens, output_tokens,
     actual_cost_usd, cost_estimated, latency_ms)
  values
    (p_chat_guid, p_source, p_model, 'shipyard-gateway',
     coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
     p_cost_usd, p_cost_estimated, p_latency_ms);
$$;

-- Spend since p_since. p_all = false: only p_chat_guid. p_all = true (owner):
-- totals across every chat plus a per-chat breakdown with the chat's handle.
create or replace function dinghy_spend_summary(
  p_chat_guid text,
  p_since timestamptz,
  p_all boolean default false
) returns json
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select u.chat_guid, u.input_tokens, u.output_tokens, u.actual_cost_usd, u.cost_estimated
    from inference_usage u
    where u.chat_guid is not null
      and u.created_at >= p_since
      and (p_all or u.chat_guid = p_chat_guid)
  ),
  per_chat as (
    select r.chat_guid,
           max(i.handle) as handle,
           count(*) as calls,
           sum(r.input_tokens + r.output_tokens) as tokens,
           coalesce(sum(r.actual_cost_usd), 0) as cost_usd
    from rows r
    left join spectrum_identities i on i.chat_guid = r.chat_guid
    group by r.chat_guid
  )
  select json_build_object(
    'calls', (select count(*) from rows),
    'input_tokens', (select coalesce(sum(input_tokens), 0) from rows),
    'output_tokens', (select coalesce(sum(output_tokens), 0) from rows),
    'cost_usd', (select coalesce(sum(actual_cost_usd), 0) from rows),
    'estimated_calls', (select count(*) from rows where cost_estimated),
    'chats', case when p_all then
      (select coalesce(json_agg(json_build_object(
          'chat_guid', chat_guid, 'handle', handle, 'calls', calls,
          'tokens', tokens, 'cost_usd', cost_usd) order by cost_usd desc), '[]'::json)
       from per_chat)
    else null end
  );
$$;

revoke all on function dinghy_record_usage(text, text, text, integer, integer, numeric, boolean, integer) from public, anon, authenticated;
revoke all on function dinghy_spend_summary(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function dinghy_record_usage(text, text, text, integer, integer, numeric, boolean, integer) to service_role;
grant execute on function dinghy_spend_summary(text, timestamptz, boolean) to service_role;

notify pgrst, 'reload schema';
