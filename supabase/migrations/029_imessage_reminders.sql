-- Reminders in iMessage: rows keyed by the Spectrum chat instead of a
-- Telegram user. Additive only: existing Telegram reminders (chat_guid
-- NULL) are untouched and still delivered by the Telegram branch of the
-- reminders cron.

alter table reminders
  add column if not exists chat_guid text;

create index if not exists reminders_chat_guid_due
  on reminders (fire_at)
  where chat_guid is not null and fired = false;

-- Reminder deliveries go through the Spectrum outbox like any other send.
alter table public.spectrum_outbox drop constraint if exists spectrum_outbox_kind_check;
alter table public.spectrum_outbox
  add constraint spectrum_outbox_kind_check
  check (kind in ('reply', 'connect_link', 'error_notice', 'file', 'reminder'));

create or replace function dinghy_reminder_create(
  p_chat_guid text,
  p_user_id uuid,
  p_message text,
  p_fire_at timestamptz
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r reminders;
begin
  if (select count(*) from reminders where chat_guid = p_chat_guid and fired = false) >= 50 then
    raise exception 'too many active reminders for this chat (max 50)';
  end if;
  insert into reminders (user_id, chat_guid, message, fire_at)
  values (p_user_id, p_chat_guid, p_message, p_fire_at)
  returning * into r;
  return json_build_object('id', r.id, 'message', r.message, 'fire_at', r.fire_at);
end;
$$;

create or replace function dinghy_reminder_list(p_chat_guid text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object('id', id, 'message', message, 'fire_at', fire_at) order by fire_at), '[]'::json)
  from reminders
  where chat_guid = p_chat_guid and fired = false;
$$;

-- Cancel = mark fired, not delete (reversible, keeps history).
create or replace function dinghy_reminder_cancel(p_chat_guid text, p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with u as (
    update reminders set fired = true
    where id = p_id and chat_guid = p_chat_guid and fired = false
    returning 1
  )
  select exists (select 1 from u);
$$;

-- Atomically claim due iMessage reminders: each row is returned to exactly
-- one caller (fired flips in the same statement), so a reminder can never
-- be enqueued twice even if cron runs overlap.
create or replace function dinghy_claim_due_reminders(p_limit integer default 100)
returns table (id uuid, chat_guid text, message text, fire_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update reminders r set fired = true
  where r.id in (
    select id from reminders
    where chat_guid is not null and fired = false and fire_at <= now()
    order by fire_at
    limit p_limit
    for update skip locked
  )
  returning r.id, r.chat_guid, r.message, r.fire_at;
$$;

-- Put a claimed reminder back if it could not be enqueued.
create or replace function dinghy_reminder_unclaim(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update reminders set fired = false where id = p_id and chat_guid is not null;
$$;

revoke all on function dinghy_reminder_create(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function dinghy_reminder_list(text) from public, anon, authenticated;
revoke all on function dinghy_reminder_cancel(text, uuid) from public, anon, authenticated;
revoke all on function dinghy_claim_due_reminders(integer) from public, anon, authenticated;
revoke all on function dinghy_reminder_unclaim(uuid) from public, anon, authenticated;
grant execute on function dinghy_reminder_create(text, uuid, text, timestamptz) to service_role;
grant execute on function dinghy_reminder_list(text) to service_role;
grant execute on function dinghy_reminder_cancel(text, uuid) to service_role;
grant execute on function dinghy_claim_due_reminders(integer) to service_role;
grant execute on function dinghy_reminder_unclaim(uuid) to service_role;

notify pgrst, 'reload schema';
