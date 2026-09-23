-- Per-chat rate limits for the public iMessage line.
--
-- Fixed windows per chat: 20 messages / 10 minutes and 200 / day. Over
-- either limit, the first message gets a short notice ('limited_notify')
-- and the rest are dropped silently ('limited') until the window rolls.
-- The owner is exempt (checked in app code before calling this).

create table if not exists public.spectrum_rate (
  chat_guid text primary key,
  short_start timestamptz not null default now(),
  short_count int not null default 0,
  day_start timestamptz not null default now(),
  day_count int not null default 0,
  notified_at timestamptz
);
alter table public.spectrum_rate enable row level security;
revoke all on public.spectrum_rate from anon, authenticated, public;

create or replace function public.hit_rate_limit(
  p_chat_guid text,
  p_short_max int default 20,
  p_short_window interval default interval '10 minutes',
  p_day_max int default 200
) returns text
language plpgsql security definer set search_path = public as $$
declare r public.spectrum_rate%rowtype;
begin
  insert into public.spectrum_rate (chat_guid) values (p_chat_guid) on conflict (chat_guid) do nothing;
  select * into r from public.spectrum_rate where chat_guid = p_chat_guid for update;

  if r.short_start < now() - p_short_window then
    r.short_start := now(); r.short_count := 0;
  end if;
  if r.day_start < now() - interval '1 day' then
    r.day_start := now(); r.day_count := 0;
  end if;
  r.short_count := r.short_count + 1;
  r.day_count := r.day_count + 1;

  update public.spectrum_rate
  set short_start = r.short_start, short_count = r.short_count,
      day_start = r.day_start, day_count = r.day_count
  where chat_guid = p_chat_guid;

  if r.short_count <= p_short_max and r.day_count <= p_day_max then
    return 'ok';
  end if;
  -- One notice per limited stretch.
  if r.notified_at is null or r.notified_at < greatest(r.short_start, case when r.day_count > p_day_max then r.day_start else r.short_start end) then
    update public.spectrum_rate set notified_at = now() where chat_guid = p_chat_guid;
    return 'limited_notify';
  end if;
  return 'limited';
end;
$$;

revoke execute on function public.hit_rate_limit(text, int, interval, int) from anon, authenticated, public;
grant execute on function public.hit_rate_limit(text, int, interval, int) to service_role;

notify pgrst, 'reload schema';
