-- Private route for Gmail/Calendar-derived content (Google Limited Use).
-- NOT applied by the patch. Apply BEFORE enabling DINGHY_PRIVATE_ROUTE=on and the expiry cron.
-- Code degrades safely if this is not applied yet (reads fall back, facts carry a channel tag).

alter table public.spectrum_messages add column if not exists google_derived boolean not null default false;
alter table public.memories add column if not exists google_derived boolean not null default false;
alter table public.conversation_summaries add column if not exists google_derived boolean not null default false;

create index if not exists spectrum_messages_google_derived_idx on public.spectrum_messages (created_at) where google_derived;
create index if not exists memories_google_derived_idx on public.memories (created_at) where google_derived;
create index if not exists conversation_summaries_google_derived_idx on public.conversation_summaries (created_at) where google_derived;

-- Backfill never embeds Google-derived rows (they only get a vector at creation, through a confirmed private endpoint).
create or replace function public.chat_rows_needing_embedding(p_chat_guid text, p_model text, p_limit int default 20)
returns table (kind text, id uuid, content text)
language sql stable security definer set search_path = public as $$
  (select 'fact'::text, m.id, m.content from public.memories m
   where m.chat_guid = p_chat_guid and m.superseded_at is null
     and not m.google_derived and m.source_channel not like '%+google'
     and (m.embedding is null or m.embedding_model is distinct from p_model)
   limit p_limit)
  union all
  (select 'summary'::text, s.id, s.summary from public.conversation_summaries s
   where s.chat_guid = p_chat_guid
     and not s.google_derived and s.embedding_model is distinct from 'google-withheld'
     and (s.embedding is null or s.embedding_model is distinct from p_model)
   limit p_limit);
$$;

create or replace function public.user_rows_needing_embedding(p_user_id uuid, p_model text, p_limit int default 20)
returns table (kind text, id uuid, content text)
language sql stable security definer set search_path = public as $$
  (select 'fact'::text, m.id, m.content from public.memories m
   where m.user_id = p_user_id and m.superseded_at is null
     and not m.google_derived and m.source_channel not like '%+google'
     and (m.embedding is null or m.embedding_model is distinct from p_model)
   limit p_limit)
  union all
  (select 'summary'::text, s.id, s.summary from public.conversation_summaries s
   join public.spectrum_identities i on i.chat_guid = s.chat_guid
   where i.user_id = p_user_id
     and not s.google_derived and s.embedding_model is distinct from 'google-withheld'
     and (s.embedding is null or s.embedding_model is distinct from p_model)
   limit p_limit);
$$;

-- Retention: hard-delete Google-derived rows older than p_days. Returns counts.
create or replace function public.expire_google_derived(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m int; f int; s int;
begin
  if p_days < 1 then raise exception 'p_days must be >= 1'; end if;
  delete from public.spectrum_messages where google_derived and created_at < now() - make_interval(days => p_days);
  get diagnostics m = row_count;
  delete from public.memories where (google_derived or source_channel like '%+google') and created_at < now() - make_interval(days => p_days);
  get diagnostics f = row_count;
  delete from public.conversation_summaries where (google_derived or embedding_model = 'google-withheld') and created_at < now() - make_interval(days => p_days);
  get diagnostics s = row_count;
  return jsonb_build_object('messages', m, 'facts', f, 'summaries', s);
end;
$$;

revoke all on function public.expire_google_derived(int) from public, anon, authenticated;
grant execute on function public.expire_google_derived(int) to service_role;
notify pgrst, 'reload schema';
