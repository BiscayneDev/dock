-- Reserve an explicit call ceiling atomically before inference. A reservation
-- is not a promise the provider honors that ceiling: upstream enforcement is
-- separately required before the coding inference route can be enabled.
create table if not exists coding_call_reservations (
  run_id uuid not null references task_runs(id) on delete cascade,
  request_id uuid not null,
  device_id uuid not null,
  ceiling_cents integer not null check (ceiling_cents > 0),
  created_at timestamptz not null default now(),
  primary key (run_id, request_id)
);
alter table coding_call_reservations enable row level security;
create or replace function reserve_coding_call(p_run_id uuid, p_request_id uuid, p_device_id uuid, p_ceiling_cents integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r task_runs%rowtype;
begin
  select * into r from task_runs where id = p_run_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'lease'); end if;
  if r.lease_owner is distinct from ('device:' || p_device_id::text)
     or r.status not in ('leased', 'running') or r.lease_until is null or r.lease_until <= now() then
    return jsonb_build_object('ok', false, 'error', 'lease');
  end if;
  if r.target is distinct from 'home' or jsonb_typeof(r.payload->'isolatedTask') is distinct from 'object'
     or r.payload->'proposedAction' is not null then
    return jsonb_build_object('ok', false, 'error', 'not_coding');
  end if;
  if exists(select 1 from coding_call_reservations where run_id = p_run_id and request_id = p_request_id) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;
  if p_ceiling_cents is null or p_ceiling_cents < 1 or r.spent_cents + p_ceiling_cents > r.budget_cents then
    return jsonb_build_object('ok', false, 'error', 'budget');
  end if;
  insert into coding_call_reservations(run_id, request_id, device_id, ceiling_cents)
    values(p_run_id, p_request_id, p_device_id, p_ceiling_cents);
  update task_runs set spent_cents = spent_cents + p_ceiling_cents where id = p_run_id;
  return jsonb_build_object('ok', true, 'spentCents', r.spent_cents + p_ceiling_cents);
end $$;
revoke all on function reserve_coding_call(uuid, uuid, uuid, integer) from public;
grant execute on function reserve_coding_call(uuid, uuid, uuid, integer) to service_role;
