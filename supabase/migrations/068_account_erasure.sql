-- REVIEW ONLY: owner approval and synthetic race test required before apply.
begin;
create table public.dinghy_erasure_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid,
 chats text[] not null default '{}',
 status text not null check (status in ('confirm','queued','cleaning','blocked','complete')),
 confirm_hash text,
 expires_at timestamptz not null,
 requested_at timestamptz not null default now(),
 frozen_at timestamptz,
 lease_until timestamptz,
 completed_at timestamptz,
 obstacle text,
 provider_notes text[] not null default '{}'
);
create unique index erasure_one_active on public.dinghy_erasure_jobs(user_id) where status <> 'complete';
-- Hash fences prevent writes from stale runs without retaining plaintext ids.
create table public.dinghy_erasure_fences (
 kind text not null check(kind in ('user','chat','phone')),
 digest text not null,
 expires_at timestamptz not null,
 primary key(kind,digest)
);
alter table public.dinghy_erasure_jobs enable row level security;
alter table public.dinghy_erasure_fences enable row level security;
revoke all on public.dinghy_erasure_jobs, public.dinghy_erasure_fences from public, anon, authenticated;
grant all on public.dinghy_erasure_jobs, public.dinghy_erasure_fences to service_role;

create function public.dinghy_erasure_blocked(p_user_id uuid default null, p_chat_guid text default null)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from dinghy_erasure_fences where expires_at > now() and
  ((kind='user' and digest=encode(extensions.digest(p_user_id::text,'sha256'),'hex')) or
   (kind='chat' and digest=encode(extensions.digest(p_chat_guid,'sha256'),'hex'))));
$$;

create function public.dinghy_erasure_request(p_user_id uuid, p_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare job uuid;
begin
 if not exists(select 1 from users where id=p_user_id) or dinghy_erasure_blocked(p_user_id,null) then raise exception 'Account unavailable'; end if;
 insert into dinghy_erasure_jobs(user_id,status,confirm_hash,expires_at)
 values(p_user_id,'confirm',p_hash,now()+interval '10 minutes')
 on conflict(user_id) where status <> 'complete' do update
 set confirm_hash=excluded.confirm_hash,expires_at=excluded.expires_at
 where dinghy_erasure_jobs.status='confirm'
 returning id into job;
 if job is null then raise exception 'Deletion already queued'; end if;
 return job;
end;
$$;
create function public.dinghy_erasure_confirm(p_user_id uuid,p_job uuid,p_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare j dinghy_erasure_jobs%rowtype; c text; phone text;
begin
 perform pg_advisory_xact_lock(hashtext('erase:user:'||p_user_id::text));
 select * into j from dinghy_erasure_jobs where id=p_job and user_id=p_user_id for update;
 if j.id is null or j.status<>'confirm' or j.expires_at<=now() or j.confirm_hash<>p_hash then return false; end if;
 select coalesce(array_agg(chat_guid order by chat_guid),'{}') into j.chats from spectrum_identities where user_id=p_user_id;
 foreach c in array j.chats loop perform pg_advisory_xact_lock(hashtext('erase:chat:'||c)); end loop;
 update recipes set enabled=false where user_id=p_user_id;
 update users set daily_briefing=false,email_monitor_enabled=false where id=p_user_id;
 update briefing_settings set enabled=false,muted=true where user_id=p_user_id;
 update dinghy_pending_actions set status='cancelled' where user_id=p_user_id and status='pending';
 delete from spectrum_outbox where chat_guid=any(j.chats);
 insert into dinghy_erasure_fences values('user',encode(extensions.digest(p_user_id::text,'sha256'),'hex'),'infinity') on conflict do nothing;
 foreach c in array j.chats loop
  insert into dinghy_erasure_fences values('chat',encode(extensions.digest(c,'sha256'),'hex'),'infinity') on conflict do nothing;
 end loop;
 for phone in select distinct handle from spectrum_identities where user_id=p_user_id and handle is not null loop
  insert into dinghy_erasure_fences values('phone',encode(extensions.digest(phone,'sha256'),'hex'),'infinity') on conflict do nothing;
 end loop;
 update dinghy_erasure_jobs set chats=j.chats,status='queued',frozen_at=now(),expires_at='infinity' where id=j.id;
 return true;
end;
$$;

-- A trigger closes the check-then-write race for all owner-keyed tables,
-- even clients which bypass app checks or use SECURITY DEFINER RPCs.
create function public.dinghy_erasure_write_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb:=to_jsonb(new); oldr jsonb; uid text; chat text; phone text;
begin
 if current_setting('dinghy.erasure_cleanup',true)='on' then return new; end if;
 if TG_OP='UPDATE' then oldr:=to_jsonb(old); end if;
 uid:=case when TG_TABLE_NAME='users' then r->>'id' else r->>'user_id' end;
 chat:=coalesce(r->>'chat_guid',case when TG_TABLE_NAME='connect_tokens' then r->>'chat_id' end,r->>'created_by_chat');
 phone:=coalesce(r->>'phone',case when TG_TABLE_NAME='spectrum_identities' then r->>'handle' end);
 if uid is not null then perform pg_advisory_xact_lock(hashtext('erase:user:'||uid)); end if;
 if chat is not null then perform pg_advisory_xact_lock(hashtext('erase:chat:'||chat)); end if;
 if exists(select 1 from dinghy_erasure_fences f where f.expires_at>now() and
  ((f.kind='user' and f.digest in(encode(extensions.digest(uid,'sha256'),'hex'),encode(extensions.digest(case when TG_TABLE_NAME='users' then oldr->>'id' else oldr->>'user_id' end,'sha256'),'hex'))) or
   (f.kind='chat' and f.digest in(encode(extensions.digest(chat,'sha256'),'hex'),encode(extensions.digest(oldr->>'chat_guid','sha256'),'hex'))) or
   (f.kind='phone' and f.digest=encode(extensions.digest(phone,'sha256'),'hex')))) then
  raise exception 'Account unavailable during data deletion' using errcode='P0001';
 end if;
 return new;
end;
$$;
-- Freeze mutations occur in confirm before guards would reject them: disabling
-- schedules is optional because all subsequent writes are fenced. Read-side
-- app guards stop provider work; deletes remain allowed for cleanup.
do $$ declare t text; begin
 for t in select distinct table_name from information_schema.columns col where table_schema='public' and exists(select 1 from information_schema.tables tab where tab.table_schema=col.table_schema and tab.table_name=col.table_name and tab.table_type='BASE TABLE') and
  (column_name in('user_id','chat_guid','created_by_chat','phone') or table_name='users')
  and table_name not like 'dinghy_erasure_%' loop
  execute format('create trigger erasure_write_guard before insert or update on public.%I for each row execute function dinghy_erasure_write_guard()',t);
 end loop;
end $$;
-- Remove freeze-time UPDATEs which guards now reject: freeze fences themselves
-- are the source of truth for disabling all queued/provider work.
create function public.dinghy_erasure_claim()
returns jsonb language plpgsql security definer set search_path=public as $$
declare j dinghy_erasure_jobs%rowtype;
begin
 select * into j from dinghy_erasure_jobs where status in('queued','cleaning','blocked')
 and (lease_until is null or lease_until<now())
 and frozen_at < now()-interval '5 minutes'
 order by requested_at for update skip locked limit 1;
 if j.id is null then
  delete from dinghy_erasure_jobs where (status='confirm' and expires_at<now()) or (status='complete' and completed_at<now()-interval '7 days');
  delete from dinghy_erasure_fences where expires_at<now();
  return null;
 end if;
 update dinghy_erasure_jobs set status='cleaning',lease_until=now()+interval '10 minutes',obstacle=null where id=j.id;
 return to_jsonb(j);
end;
$$;

-- Dynamic owner-column coverage catches new tables instead of silently relying
-- on cascades. It is intentionally limited to explicit ownership keys.
create function public.dinghy_erasure_finish(p_job uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare j dinghy_erasure_jobs%rowtype; t record; n bigint; phones text[];
begin
 select * into j from dinghy_erasure_jobs where id=p_job for update;
 if j.id is null or j.status<>'cleaning' or j.lease_until<now() then return false; end if;
 perform set_config('dinghy.erasure_cleanup','on',true);
 select coalesce(array_agg(handle),'{}') into phones from spectrum_identities where user_id=j.user_id and handle is not null;
 -- Waitlist admission is verified by the existing bound phone, not an email guess.
 delete from waitlist_admit_queue where email in(select email from waitlist where phone=any(phones));
 delete from waitlist where phone=any(phones);
 for t in select distinct table_name,column_name from information_schema.columns col where table_schema='public' and exists(select 1 from information_schema.tables tab where tab.table_schema=col.table_schema and tab.table_name=col.table_name and tab.table_type='BASE TABLE')
 and column_name in('user_id','chat_guid','created_by_chat') and table_name not like 'dinghy_erasure_%'
 and table_name<>'spectrum_identities' loop
  if t.column_name='user_id' then execute format('delete from public.%I where user_id=$1',t.table_name) using j.user_id;
  else execute format('delete from public.%I where %I=any($1)',t.table_name,t.column_name) using j.chats;
  end if;
 end loop;
 delete from connect_tokens where chat_id=any(j.chats) or user_id=j.user_id;
 delete from spectrum_identities where user_id=j.user_id;
 delete from users where id=j.user_id;
 for t in select distinct table_name,column_name from information_schema.columns col where table_schema='public' and exists(select 1 from information_schema.tables tab where tab.table_schema=col.table_schema and tab.table_name=col.table_name and tab.table_type='BASE TABLE')
 and column_name in('user_id','chat_guid','created_by_chat') and table_name not like 'dinghy_erasure_%' loop
  if t.column_name='user_id' then execute format('select count(*) from public.%I where user_id=$1',t.table_name) into n using j.user_id;
  else execute format('select count(*) from public.%I where %I=any($1)',t.table_name,t.column_name) into n using j.chats; end if;
  if n<>0 then raise exception 'Deletion verification failed'; end if;
 end loop;
 update dinghy_erasure_fences set expires_at=now()+interval '30 days' where
 (kind='user' and digest=encode(extensions.digest(j.user_id::text,'sha256'),'hex')) or
 (kind='chat' and digest in(select encode(extensions.digest(c,'sha256'),'hex') from unnest(j.chats)c)) or
 (kind='phone' and digest in(select encode(extensions.digest(p,'sha256'),'hex') from unnest(phones)p));
 update dinghy_erasure_jobs set user_id=null,chats='{}',status='complete',lease_until=null,completed_at=now(),obstacle=null where id=j.id;
 return true;
end;
$$;
do $$ declare f text; begin foreach f in array array[
 'dinghy_erasure_blocked(uuid,text)','dinghy_erasure_request(uuid,text)','dinghy_erasure_confirm(uuid,uuid,text)','dinghy_erasure_claim()','dinghy_erasure_finish(uuid)','dinghy_erasure_write_guard()'
] loop execute format('revoke all on function public.%s from public,anon,authenticated',f);
 execute format('grant execute on function public.%s to service_role',f); end loop; end $$;
commit;
notify pgrst,'reload schema';
