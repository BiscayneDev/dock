-- Daily usage allowance: one pool per account, in USD-cost-equivalent,
-- covering ALL work (LLM calls, sandbox time, briefings, sweeps). Resets at
-- midnight in the account's timezone. Invisible until the limit is hit.
-- Replaces the "30 free sandbox minutes" gate (free_seconds_per_day stays
-- in the schema, deprecated, no longer read by code). Additive only.
--
-- Account identity: the iMessage path keys usage by Spectrum chat_guid
-- (inference_usage.chat_guid, migration 028); sandbox time keys by
-- users.id (spend_events, migration 043). spectrum_identities binds the
-- two, so one function serves both paths. Unbound guest chats meter by
-- chat_guid with the default allowance.

alter table public.computer_settings
  add column if not exists daily_allowance_usd numeric not null default 2.00,
  add column if not exists allowance_timezone text;

-- One at-limit notice per chat per local day: "that's today's allowance
-- used up - i'm back at midnight your time." then quiet until reset.
create table if not exists public.daily_limit_notices (
  chat_guid text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (chat_guid, day)
);

alter table public.daily_limit_notices enable row level security;
-- No policies: service-role only, like inference_usage (028).

-- Today's usage for one account. p_chat_guid and p_user_id are both
-- optional; pass whichever the caller has. Timezone resolution:
-- explicit p_tz, then computer_settings.allowance_timezone, then
-- users.timezone, then America/New_York (the Dinghy owner convention).
create or replace function public.dinghy_daily_usage(
  p_chat_guid text default null,
  p_user_id uuid default null,
  p_tz text default null
) returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := p_user_id;
  v_tz text;
  v_day_start timestamptz;
  v_llm numeric := 0;
  v_sandbox numeric := 0;
  v_allowance numeric := 2.00;
begin
  if v_user_id is null and p_chat_guid is not null then
    select si.user_id into v_user_id
      from spectrum_identities si
     where si.chat_guid = p_chat_guid;
  end if;

  select coalesce(
           p_tz,
           (select cs.allowance_timezone from computer_settings cs
             where cs.user_id = v_user_id and cs.allowance_timezone is not null),
           (select u.timezone from users u
             where u.id = v_user_id and u.timezone is not null and u.timezone <> 'UTC'),
           'America/New_York'
         )
    into v_tz;

  begin
    v_day_start := ((now() at time zone v_tz)::date)::timestamp at time zone v_tz;
  exception when invalid_parameter_value then
    v_tz := 'America/New_York';
    v_day_start := ((now() at time zone v_tz)::date)::timestamp at time zone v_tz;
  end;

  select cs.daily_allowance_usd into v_allowance
    from computer_settings cs
   where cs.user_id = v_user_id;
  v_allowance := coalesce(v_allowance, 2.00);

  -- LLM cost: iMessage rows keyed by chat_guid, Telegram/legacy rows by
  -- user_id. actual_cost_usd is the real gateway cost (list-price estimate
  -- when the gateway did not report one).
  select coalesce(sum(iu.actual_cost_usd), 0) into v_llm
    from inference_usage iu
   where iu.created_at >= v_day_start
     and (
       (p_chat_guid is not null and iu.chat_guid = p_chat_guid)
       or (v_user_id is not null and iu.user_id = v_user_id)
     );

  -- Sandbox wall-clock spend from the shared ledger. Only source='sandbox'
  -- is usage; money rails stay under the hard cap, not the allowance.
  -- 'overage:' memos are purchases of more time, not usage.
  if v_user_id is not null then
    select coalesce(sum(se.amount_usd), 0) into v_sandbox
      from spend_events se
     where se.created_at >= v_day_start
       and se.user_id = v_user_id
       and se.source = 'sandbox'
       and (se.memo is null or se.memo not like 'overage:%');
  end if;

  return json_build_object(
    'tz', v_tz,
    'day_start', v_day_start,
    'llm_cost_usd', v_llm,
    'sandbox_cost_usd', v_sandbox,
    'cost_usd', v_llm + v_sandbox,
    'allowance_usd', v_allowance,
    'remaining_usd', greatest(v_allowance - v_llm - v_sandbox, 0),
    'over', (v_llm + v_sandbox) >= v_allowance,
    'resets_at', v_day_start + interval '1 day'
  );
end;
$$;

-- Claim the one at-limit notice for this chat's local day. Returns true
-- exactly once per day (the insert wins); false after that.
create or replace function public.dinghy_claim_limit_notice(
  p_chat_guid text,
  p_tz text default 'America/New_York'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
begin
  begin
    v_day := (now() at time zone p_tz)::date;
  exception when invalid_parameter_value then
    v_day := (now() at time zone 'America/New_York')::date;
  end;
  insert into daily_limit_notices (chat_guid, day) values (p_chat_guid, v_day)
  on conflict do nothing;
  return found;
end;
$$;

revoke all on function public.dinghy_daily_usage(text, uuid, text) from public, anon, authenticated;
revoke all on function public.dinghy_claim_limit_notice(text, text) from public, anon, authenticated;
grant execute on function public.dinghy_daily_usage(text, uuid, text) to service_role;
grant execute on function public.dinghy_claim_limit_notice(text, text) to service_role;

notify pgrst, 'reload schema';
