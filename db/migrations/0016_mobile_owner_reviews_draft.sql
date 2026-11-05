-- DRAFT ONLY. Stores immutable backend-prepared exact review packets; no worker
-- or phone can author these. Does not activate dispatch or grant any live spend.
begin;
create table public.mobile_execution_reviews(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references mobile_task_proposals(id),
 owner_id uuid not null references users(id),workspace_id uuid not null references workspaces(id),
 packet jsonb not null,digest text not null check(digest~'^[a-f0-9]{64}$'),expires_at timestamptz not null,
 state text not null default 'review'check(state in('review','approved','revoked')),
 execution_id uuid references mobile_executions(id),created_at timestamptz not null default now(),approved_at timestamptz
);
alter table mobile_execution_reviews enable row level security;
revoke all on mobile_execution_reviews from anon,authenticated;
create function public.mobile_owner_approve(p_review uuid,p_owner uuid,p_workspace uuid,p_digest text)returns uuid language plpgsql security definer set search_path=public as $$
declare r mobile_execution_reviews;p mobile_task_proposals;g mobile_grants;e uuid;
begin
 select * into r from mobile_execution_reviews where id=p_review and owner_id=p_owner and workspace_id=p_workspace for update;
 if not found or r.state<>'review'or r.expires_at<=now()or r.digest is distinct from p_digest then raise exception 'Review expired, changed or already decided';end if;
 select * into p from mobile_task_proposals where id=r.proposal_id and owner_id=p_owner and workspace_id=p_workspace for update;
 if not found or p.status<>'proposed'then raise exception 'Proposal not current';end if;
 select grants.* into g from mobile_grants grants join mobile_sessions s on s.device_id=grants.device_id where s.id=p.session_id and grants.owner_id=p_owner and grants.workspace_id=p_workspace and grants.revoked_at is null;
 if not found or not(r.packet#>>'{source,repoKey}'=any(g.repo_keys))or(r.packet->>'proposalId')is distinct from p.id::text or(r.packet->>'ownerId')is distinct from p_owner::text or(r.packet->>'workspaceId')is distinct from p_workspace::text then raise exception 'Current exact source/owner scope required';end if;
 if(r.packet#>>'{model,quoteAndSettlementEnforced}')is distinct from'true'or(r.packet#>>'{compute,storageUntilDeleted}')is distinct from'true'or(r.packet#>>'{cleanup,retainedInstanceExclusion}')is distinct from'true'or coalesce(r.packet#>>'{model,gatewayEvidence}','')=''or coalesce(r.packet#>>'{cleanup,watchdogEvidence}','')=''or(r.packet#>>'{cleanup,deadline}')::timestamptz<=now()or jsonb_array_length(r.packet#>'{source,paths}')<1 or length(coalesce(r.packet->>'text',''))=0 then raise exception 'Qualified runtime terms unavailable';end if;
 insert into mobile_executions(proposal_id,owner_id,workspace_id,project_id,agent_key,repo_key,source_commit,approved_proposal_digest,owner_decision_ref,managed_budget_micros,max_compute_cost_micros,lifecycle_approved,cleanup_deadline,state,decision_expires_at,approved_text,source_paths)
 values(p.id,p_owner,p_workspace,p.project_id,r.packet->>'agentId',r.packet#>>'{source,repoKey}',r.packet#>>'{source,commit}',r.digest,'owner-review:'||r.id,(r.packet#>>'{model,budgetMicros}')::bigint,(r.packet#>>'{compute,maxApprovedMicros}')::bigint,true,(r.packet#>>'{cleanup,deadline}')::timestamptz,'approved',r.expires_at,r.packet->>'text',array(select jsonb_array_elements_text(r.packet#>'{source,paths}')))returning id into e;
 update mobile_task_proposals set status='approved',approved_digest=r.digest,approved_at=now()where id=p.id;
 update mobile_execution_reviews set state='approved',execution_id=e,approved_at=now()where id=r.id;
 return e;
end;$$;
revoke all on function public.mobile_owner_approve(uuid,uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.mobile_owner_approve(uuid,uuid,uuid,text)to service_role;
commit;
