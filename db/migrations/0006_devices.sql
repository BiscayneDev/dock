-- Home node (P2): paired devices, one-time pairing codes, and home-only claims. Idempotent: safe to re-run.
-- Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * Devices and pairings are owner-only (RLS). Only the owner's session creates and revokes devices.
--   * Device tokens are never stored. Only sha256(salt || secret) is stored, with a per-row salt.
--   * Pairing codes are single use and expire. redeem_device_pairing() is the only way to consume one (service role).
--   * claim_task_run() (cloud worker) claims target='cloud' only. Home runs are never claimed by the cloud.
--   * claim_home_run() claims target='home' runs of the device owner only, and only while the device is fresh
--     (heartbeat within 120s, not revoked). No cloud fallback: home runs wait in the queue while the device is offline.
--   * A run leased to a device has lease_owner = 'device:<device id>'. Expired leases are recovered by either claim.

begin;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_salt text check (token_salt is null or char_length(token_salt) between 16 and 128),
  token_hash text check (token_hash is null or char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index if not exists devices_owner_idx on public.devices (owner_id, created_at desc);

create table if not exists public.device_pairings (
  code_hash text primary key check (char_length(code_hash) = 64),
  device_id uuid not null references public.devices(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_pairings_device_idx on public.device_pairings (device_id);

alter table public.devices enable row level security;
alter table public.device_pairings enable row level security;

drop policy if exists devices_all_owner on public.devices;
create policy devices_all_owner on public.devices for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

drop policy if exists device_pairings_all_owner on public.device_pairings;
create policy device_pairings_all_owner on public.device_pairings for all to authenticated
  using (device_id in (select d.id from public.devices d where d.owner_id = (select auth.uid())))
  with check (device_id in (select d.id from public.devices d where d.owner_id = (select auth.uid())));

-- Consume a pairing code and set the device's token hash, atomically. Returns the device id, or null
-- when the code is unknown, used, expired, or the device is revoked or already paired.
create or replace function public.redeem_device_pairing(p_code_hash text, p_token_salt text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device uuid;
begin
  if p_code_hash is null or char_length(p_code_hash) <> 64 then raise exception 'invalid pairing'; end if;
  if p_token_salt is null or char_length(p_token_salt) not between 16 and 128 then raise exception 'invalid salt'; end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then raise exception 'invalid token hash'; end if;

  update public.device_pairings p
     set used_at = now()
   where p.code_hash = p_code_hash
     and p.used_at is null
     and p.expires_at > now()
     and exists (
       select 1 from public.devices d
        where d.id = p.device_id and d.revoked_at is null and d.token_hash is null
     )
  returning p.device_id into v_device;

  if v_device is null then return null; end if;

  update public.devices
     set token_salt = p_token_salt, token_hash = p_token_hash, last_seen_at = now()
   where id = v_device;
  return v_device;
end;
$$;

revoke all on function public.redeem_device_pairing(text, text, text) from public;
revoke all on function public.redeem_device_pairing(text, text, text) from anon;
revoke all on function public.redeem_device_pairing(text, text, text) from authenticated;
grant execute on function public.redeem_device_pairing(text, text, text) to service_role;

-- Cloud worker claim. Narrowed to target='cloud' so a home run is never claimed by the cloud.
-- Expired-lease recovery still covers every target (a home run whose device died is requeued, not lost).
create or replace function public.claim_task_run(p_worker text, p_lease_seconds integer default 120)
returns setof public.task_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.task_runs;
begin
  if p_worker is null or char_length(p_worker) = 0 or char_length(p_worker) > 200 then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'lease must be 10..900 seconds';
  end if;

  with recovered as (
    update public.task_runs t
       set status = case when t.attempts >= t.max_attempts then 'failed' else 'queued' end,
           error = case when t.attempts >= t.max_attempts then 'lease expired' else t.error end,
           finished_at = case when t.attempts >= t.max_attempts then now() else t.finished_at end,
           lease_owner = null,
           lease_until = null,
           updated_at = now()
     where t.status in ('leased', 'running') and t.lease_until < now()
    returning t.id, t.status, t.attempts, t.lease_owner
  )
  insert into public.task_run_events (run_id, kind, data)
  select id, 'lease_expired',
         jsonb_build_object('next_status', status, 'attempts', attempts, 'previous_worker', lease_owner)
    from recovered;

  update public.task_runs t
     set status = 'leased',
         lease_owner = p_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         attempts = t.attempts + 1,
         started_at = coalesce(t.started_at, now()),
         updated_at = now()
   where t.id = (
           select q.id from public.task_runs q
            where q.status = 'queued' and q.target = 'cloud'
            order by q.created_at
            for update skip locked
            limit 1
         )
     and t.status = 'queued'
  returning t.* into r;

  if found then
    insert into public.task_run_events (run_id, kind, data)
    values (r.id, 'leased', jsonb_build_object('worker', p_worker, 'attempt', r.attempts));
    return next r;
  end if;
  return;
end;
$$;

-- Home-node claim for one paired device. Fresh device only (heartbeat within 120s, not revoked, paired).
-- Returns no row when the device is stale or nothing is queued for it. There is no cloud fallback.
create or replace function public.claim_home_run(p_device_id uuid, p_lease_seconds integer default 120)
returns setof public.task_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.devices;
  r public.task_runs;
  v_worker text;
begin
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'lease must be 10..900 seconds';
  end if;

  select * into d from public.devices where id = p_device_id;
  if not found or d.revoked_at is not null or d.token_hash is null then return; end if;
  if d.last_seen_at is null or d.last_seen_at < now() - interval '120 seconds' then return; end if;
  v_worker := 'device:' || d.id::text;

  with stale as (
    select t.id, t.lease_owner, t.attempts, t.max_attempts
      from public.task_runs t
     where t.target = 'home' and t.owner_id = d.owner_id
       and t.status in ('leased', 'running') and t.lease_until < now()
       for update skip locked
  ),
  recovered as (
    update public.task_runs t
       set status = case when s.attempts >= s.max_attempts then 'failed' else 'queued' end,
           error = case when s.attempts >= s.max_attempts then 'lease expired' else t.error end,
           finished_at = case when s.attempts >= s.max_attempts then now() else t.finished_at end,
           lease_owner = null,
           lease_until = null,
           updated_at = now()
      from stale s
     where t.id = s.id
    returning t.id, t.status, t.attempts, s.lease_owner as previous_worker
  )
  insert into public.task_run_events (run_id, kind, data)
  select id, 'lease_expired',
         jsonb_build_object('next_status', status, 'attempts', attempts, 'previous_worker', previous_worker)
    from recovered;

  update public.task_runs t
     set status = 'leased',
         lease_owner = v_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         attempts = t.attempts + 1,
         started_at = coalesce(t.started_at, now()),
         updated_at = now()
   where t.id = (
           select q.id from public.task_runs q
            where q.status = 'queued' and q.target = 'home'
              and q.owner_id = d.owner_id and q.workspace_id = d.workspace_id
            order by q.created_at
            for update skip locked
            limit 1
         )
     and t.status = 'queued'
  returning t.* into r;

  if found then
    insert into public.task_run_events (run_id, kind, data)
    values (r.id, 'leased', jsonb_build_object('worker', v_worker, 'attempt', r.attempts, 'target', 'home'));
    return next r;
  end if;
  return;
end;
$$;

revoke all on function public.claim_home_run(uuid, integer) from public;
revoke all on function public.claim_home_run(uuid, integer) from anon;
revoke all on function public.claim_home_run(uuid, integer) from authenticated;
grant execute on function public.claim_home_run(uuid, integer) to service_role;

commit;

notify pgrst, 'reload schema';
