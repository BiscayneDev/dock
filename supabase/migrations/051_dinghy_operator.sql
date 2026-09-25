-- A waitlist signup is active after the first allowlisted inbound text/photo.
-- Never infer this from an invite email or a Photon registration alone.
alter table public.waitlist add column if not exists first_text_at timestamptz;
alter table public.waitlist add column if not exists line_assigned_at timestamptz;
alter table public.waitlist add column if not exists invite_sent_at timestamptz;
create index if not exists waitlist_status_created_idx on public.waitlist(status, created_at desc);
create index if not exists waitlist_phone_idx on public.waitlist(phone) where phone is not null;
create index if not exists spectrum_messages_chat_role_time_idx on public.spectrum_messages(chat_guid, role, created_at desc);
create index if not exists spectrum_outbox_status_time_idx on public.spectrum_outbox(status, created_at);

-- Existing invite rows are not auto-promoted. A pre-invite chat or an
-- unverified historical handle could otherwise make the funnel lie.

-- This is admin-only data. The route checks getAdminSession and calls this
-- with the service role. No public/authenticated EXECUTE grant.
create or replace function public.dinghy_operator_overview()
returns jsonb language sql stable security definer set search_path = public
as $$
with clock as (
  select now() as at, date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York' as day_start),
people as (
  select w.id, w.name, w.email, w.phone, w.status, w.created_at, w.updated_at,
         w.dinghy_line, w.confirmation_sent_at, w.intro_texted_at, w.first_text_at,
         w.line_assigned_at, w.invite_sent_at,
         i.chat_guid,
         (select max(m.created_at) from spectrum_messages m
          where m.chat_guid = i.chat_guid and m.role = 'user' and m.created_at >= w.first_text_at) as last_inbound_at,
         (select max(m.created_at) from spectrum_messages m
          where m.chat_guid = i.chat_guid and m.role = 'assistant' and m.created_at >= w.first_text_at) as last_reply_at
  from waitlist w
  left join lateral (
    select si.chat_guid from spectrum_identities si
    join beta_allowlist ba on ba.chat_guid = si.chat_guid
    where si.handle = w.phone and ba.role = 'member'
      and w.status = 'active' and w.first_text_at is not null
    order by si.created_at desc limit 1
  ) i on true
),
summary as (
  select count(*) as signups,
         count(*) filter (where status = 'joined') as waiting,
         count(*) filter (where status = 'invited' and first_text_at is null) as awaiting_first_text,
         count(*) filter (where status = 'active') as active_signups
  from waitlist
),
active7d as (
  select count(distinct m.chat_guid) as total from spectrum_messages m
  join beta_allowlist b on b.chat_guid = m.chat_guid and b.role = 'member'
  cross join clock c
  where m.role = 'user' and m.created_at >= c.at - interval '7 days'
),
spend as (
  select coalesce((select sum(u.actual_cost_usd) from inference_usage u cross join clock c
                   where u.chat_guid is not null and u.created_at >= c.day_start), 0)
       + coalesce((select sum(se.amount_usd) from spend_events se cross join clock c
                   where se.source = 'sandbox' and (se.memo is null or se.memo not like 'overage:%')
                     and se.created_at >= c.day_start), 0) as usd
),
failed as (
  select count(*) as total from spectrum_outbox o
  where o.status = 'pending' and o.attempts > 0
),
queue as (
  select p.* from (
    select id from waitlist where status = 'joined' or (status = 'invited' and first_text_at is null)
    order by case when status = 'joined' then 0 else 1 end, created_at asc limit 50
  ) selected join people p on p.id = selected.id
),
recent as (
  select p.* from (select id from waitlist where status = 'active' order by first_text_at desc nulls last limit 25) selected
  join people p on p.id = selected.id
)
select jsonb_build_object(
 'asOf', (select at from clock),
 'todayTimezone', 'America/New_York',
 'counts', jsonb_build_object('signups', s.signups, 'waiting', s.waiting,
   'awaitingFirstText', s.awaiting_first_text, 'activeSignups', s.active_signups,
   'active7d', a.total, 'retryingSends', f.total, 'todayCostUsd', sp.usd),
 'queue', coalesce((select jsonb_agg(jsonb_build_object(
   'id', q.id, 'name', q.name, 'email', q.email, 'phone', q.phone,
   'status', q.status, 'createdAt', q.created_at, 'line', q.dinghy_line,
   'lineAssignedAt', q.line_assigned_at, 'inviteSentAt', q.invite_sent_at,
   'confirmationSentAt', q.confirmation_sent_at, 'introTextedAt', q.intro_texted_at,
   'firstTextAt', q.first_text_at,
   'lastInboundAt', q.last_inbound_at, 'lastReplyAt', q.last_reply_at)
   order by case when q.status = 'joined' then 0 else 1 end, q.created_at asc) from queue q), '[]'::jsonb),
 'recent', coalesce((select jsonb_agg(jsonb_build_object(
   'id', r.id, 'name', r.name, 'email', r.email, 'phone', r.phone,
   'status', r.status, 'createdAt', r.created_at, 'line', r.dinghy_line,
   'lineAssignedAt', r.line_assigned_at, 'inviteSentAt', r.invite_sent_at,
   'confirmationSentAt', r.confirmation_sent_at, 'introTextedAt', r.intro_texted_at,
   'firstTextAt', r.first_text_at,
   'lastInboundAt', r.last_inbound_at, 'lastReplyAt', r.last_reply_at)
   order by r.last_inbound_at desc nulls last, r.first_text_at desc nulls last) from recent r), '[]'::jsonb)
) from summary s cross join active7d a cross join failed f cross join spend sp;
$$;
revoke all on function public.dinghy_operator_overview() from public, anon, authenticated;
grant execute on function public.dinghy_operator_overview() to service_role;
notify pgrst, 'reload schema';
