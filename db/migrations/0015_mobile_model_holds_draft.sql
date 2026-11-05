-- DRAFT ONLY, not applied. No grants, quote issuer or inference activation.
begin;
create table public.mobile_model_holds(
 id uuid primary key default gen_random_uuid(),execution_id uuid not null references mobile_executions(id),request_id uuid not null,
 quote_id text not null,max_cost_micros bigint not null check(max_cost_micros>=0),cost_micros bigint check(cost_micros>=0),
 state text not null default 'reserved'check(state in('reserved','settled','reconcile')),
 created_at timestamptz not null default now(),settled_at timestamptz,unique(execution_id,request_id)
);
alter table public.mobile_model_holds enable row level security;
revoke all on public.mobile_model_holds from anon,authenticated;
create function public.mobile_model_reserve(p_execution uuid,p_request uuid,p_quote text,p_max bigint)returns uuid language plpgsql security definer set search_path=public as $$
declare e mobile_executions;h mobile_model_holds;used bigint;
begin
 select * into e from mobile_executions where id=p_execution for update;
 if not found or e.state not in('bound','start_intent','running')or e.decision_expires_at is null or e.decision_expires_at<=now()or e.cleanup_deadline<=now()or p_max is null or p_max<0 or p_request is null or p_quote is null or length(p_quote)=0 then raise exception 'Current execution and quote required';end if;
 if not exists(select 1 from mobile_task_proposals p join mobile_sessions s on s.id=p.session_id join mobile_grants g on g.device_id=s.device_id where p.id=e.proposal_id and p.owner_id=e.owner_id and p.workspace_id=e.workspace_id and p.status='approved'and p.approved_digest=e.approved_proposal_digest and g.revoked_at is null and g.owner_id=e.owner_id and g.workspace_id=e.workspace_id and e.repo_key=any(g.repo_keys))then raise exception 'Decision revoked';end if;
 select * into h from mobile_model_holds where execution_id=e.id and request_id=p_request;
 -- A duplicate request never authorizes another paid serve, even after settle.
 if found then raise exception 'Request already reserved; inspect existing outcome';end if;
 select coalesce(sum(case when state='settled'then cost_micros else max_cost_micros end),0)into used from mobile_model_holds where execution_id=e.id;
 if used+p_max>e.managed_budget_micros then raise exception 'Execution budget exhausted';end if;
 insert into mobile_model_holds(execution_id,request_id,quote_id,max_cost_micros)values(e.id,p_request,p_quote,p_max)returning * into h;
 return h.id;
end;$$;
create function public.mobile_model_settle(p_hold uuid,p_request uuid,p_cost bigint)returns boolean language plpgsql security definer set search_path=public as $$
declare h mobile_model_holds;
begin
 select * into h from mobile_model_holds where id=p_hold for update;
 if not found or h.request_id<>p_request or p_request is null or p_cost is null or p_cost<0 or p_cost>h.max_cost_micros then raise exception 'Bound settlement required';end if;
 if h.state='settled'then if h.cost_micros<>p_cost then raise exception 'Conflicting settlement';end if;return false;end if;
 update mobile_model_holds set state='settled',cost_micros=p_cost,settled_at=now()where id=h.id;return true;
end;$$;
revoke all on function public.mobile_model_reserve(uuid,uuid,text,bigint),public.mobile_model_settle(uuid,uuid,bigint)from public,anon,authenticated;
grant execute on function public.mobile_model_reserve(uuid,uuid,text,bigint),public.mobile_model_settle(uuid,uuid,bigint)to service_role;
commit;
