-- Review-only preparation. No production migration has been applied.
-- Each invocation receives a fresh versioned lease. Provision/launch intents
-- are never reclaimed as work; only launched read polling may resume after crash.
create function public.claim_t3_step(p_id uuid,p_worker text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t t3_owner_tasks%rowtype;
begin
 if p_worker is null or p_worker !~ '^t3:[a-zA-Z0-9_-]{1,64}$'then raise exception 'invalid worker';end if;
 select * into t from t3_owner_tasks where id=p_id for update;
 if not found or t.cleanup_deadline<=now() or t.phase not in('queued','ready','launched')then return null;end if;
 if t.worker is not null and (t.phase<>'launched' or t.lease_until>now())then return null;end if;
 if t.phase='ready' and t.lease_until<=now()then return null;end if;
 update t3_owner_tasks set phase=case when phase='queued' then 'provisioning' else phase end,
 worker=p_worker,version=version+1,lease_until=least(now()+interval '3 minutes',cleanup_deadline),updated_at=now()
 where id=p_id returning * into t;return to_jsonb(t);
end $$;
create function public.release_t3_step(p_id uuid,p_version int,p_worker text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update t3_owner_tasks set worker=null,version=version+1,updated_at=now()
 where id=p_id and version=p_version and worker=p_worker and phase in('ready','launched') and lease_until>now() and cleanup_deadline>now();
 if not found then raise exception 'stale step release';end if;return true;
end $$;
-- Independent watchdog must not steal resumable read-only polling before deadline.
create or replace function public.take_t3_cleanup(p_id uuid,p_worker text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t t3_owner_tasks%rowtype;
begin
 if p_worker is null or p_worker !~ '^t3:[a-zA-Z0-9_-]{1,64}$'then raise exception 'invalid worker';end if;
 select * into t from t3_owner_tasks where id=p_id for update;
 if not found or t.phase='deleted' or (t.phase='launched' and t.cleanup_deadline>now()) or
 (t.phase='cleanup_due' and t.lease_until>now()) or
 (t.phase<>'cleanup_due' and t.cleanup_deadline>now()and coalesce(t.lease_until,t.cleanup_deadline)>now())then return null;end if;
 update t3_owner_tasks set phase='cleanup_due',worker=p_worker,version=version+1,lease_until=now()+interval '3 minutes',updated_at=now()where id=p_id returning * into t;return to_jsonb(t);
end $$;
revoke all on function public.claim_t3_step(uuid,text),public.release_t3_step(uuid,int,text) from public,anon,authenticated;
grant execute on function public.claim_t3_step(uuid,text),public.release_t3_step(uuid,int,text) to service_role;
