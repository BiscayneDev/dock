-- Pre-model claim for the morning brief. The unique delivery row used to be
-- inserted AFTER the model call, so overlapping or replayed cron runs could
-- each pay for a full generation before one lost the insert. Now the claim
-- comes first, with a lease so a crashed run can be retried.
--
-- Existing rows are finished deliveries: they backfill to status 'sent'.
-- Reversible: see the rollback notes at the bottom.

alter table public.dinghy_brief_delivery
  add column if not exists request_key text not null default 'daily',
  add column if not exists status text not null default 'sent',
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempts integer not null default 1,
  add column if not exists completed_at timestamptz;

alter table public.dinghy_brief_delivery
  drop constraint if exists dinghy_brief_delivery_status_check;
alter table public.dinghy_brief_delivery
  add constraint dinghy_brief_delivery_status_check check (status in ('claimed', 'sent'));

-- One row per (user, local day, request key): 'daily' for the scheduled
-- brief, 'now:<force_until>' for an explicit "brief me now".
alter table public.dinghy_brief_delivery drop constraint if exists dinghy_brief_delivery_pkey;
alter table public.dinghy_brief_delivery add primary key (user_id, local_day, request_key);

-- Atomic claim. True when this caller owns the generation: a new row, or an
-- expired, unfinished lease that has attempts left. False for a finished
-- brief, a live lease held by another run, or an exhausted retry budget.
create or replace function public.claim_dinghy_brief(
  p_user_id uuid,
  p_local_day date,
  p_request_key text,
  p_lease_ms integer default 600000,
  p_max_attempts integer default 3
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claimed boolean := false;
begin
  insert into public.dinghy_brief_delivery as d
    (user_id, local_day, request_key, status, claimed_at, lease_expires_at, attempts)
  values
    (p_user_id, p_local_day, p_request_key, 'claimed', now(),
     now() + (p_lease_ms || ' milliseconds')::interval, 1)
  on conflict (user_id, local_day, request_key) do update
    set claimed_at = now(),
        lease_expires_at = now() + (p_lease_ms || ' milliseconds')::interval,
        attempts = d.attempts + 1
    where d.status = 'claimed'
      and d.lease_expires_at < now()
      and d.attempts < p_max_attempts
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

revoke execute on function public.claim_dinghy_brief(uuid, date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_dinghy_brief(uuid, date, text, integer, integer) to service_role;

-- Atomic enqueue + completion. Inserts the outbox row and flips the claim to
-- 'sent' in ONE transaction (one function call), so there is no window where
-- the brief is queued but the claim still looks reclaimable. Returns the new
-- outbox id, or NULL when the key is already 'sent' (another run delivered it:
-- the caller must not send). Raises when no claim row exists. The row lock
-- serialises a stale run racing a reclaiming run: exactly one gets the id.
create or replace function public.enqueue_dinghy_brief(
  p_user_id uuid,
  p_local_day date,
  p_request_key text,
  p_chat_guid text,
  p_kind text,
  p_text text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_outbox_id uuid;
begin
  select status into v_status
    from public.dinghy_brief_delivery
    where user_id = p_user_id and local_day = p_local_day and request_key = p_request_key
    for update;
  if not found then
    raise exception 'no brief claim for % % %', p_user_id, p_local_day, p_request_key;
  end if;
  if v_status = 'sent' then
    return null;
  end if;
  insert into public.spectrum_outbox (chat_guid, kind, text, lease_claimed_at)
    values (p_chat_guid, p_kind, p_text, now())
    returning id into v_outbox_id;
  update public.dinghy_brief_delivery
    set status = 'sent', completed_at = now()
    where user_id = p_user_id and local_day = p_local_day and request_key = p_request_key;
  return v_outbox_id;
end;
$$;

revoke execute on function public.enqueue_dinghy_brief(uuid, date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_dinghy_brief(uuid, date, text, text, text, text) to service_role;

-- Rollback (manual):
--   drop function public.enqueue_dinghy_brief(uuid, date, text, text, text, text);
--   drop function public.claim_dinghy_brief(uuid, date, text, integer, integer);
--   delete from public.dinghy_brief_delivery where request_key <> 'daily';
--   alter table public.dinghy_brief_delivery drop constraint dinghy_brief_delivery_pkey;
--   alter table public.dinghy_brief_delivery add primary key (user_id, local_day);
--   alter table public.dinghy_brief_delivery drop column request_key, drop column status,
--     drop column lease_expires_at, drop column attempts, drop column completed_at;
