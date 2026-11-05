-- DRAFT ONLY. Service-owned provisioning; no live credentials issued by migration.
begin;
create function public.mobile_capability_issue(p_execution uuid,p_hash text,p_expires timestamptz)returns uuid language plpgsql security definer set search_path=public as $$
declare e mobile_executions;c uuid;
begin
 select * into e from mobile_executions where id=p_execution for update;
 if not found or e.state not in('bound','start_intent')or e.instance_id is null or e.decision_expires_at is null or e.decision_expires_at<=now()or e.cleanup_deadline<=now()or p_expires is null or p_expires<=now()or p_expires>least(e.decision_expires_at,e.cleanup_deadline)or p_hash is null or p_hash!~'^[a-f0-9]{64}$'then raise exception 'Current exact provisioned execution required';end if;
 if not exists(select 1 from mobile_task_proposals p join mobile_sessions s on s.id=p.session_id join mobile_grants g on g.device_id=s.device_id join devices d on d.id=g.device_id where p.id=e.proposal_id and p.owner_id=e.owner_id and p.workspace_id=e.workspace_id and p.project_id is not distinct from e.project_id and p.status='approved'and p.approved_digest=e.approved_proposal_digest and g.revoked_at is null and d.revoked_at is null and g.owner_id=e.owner_id and g.workspace_id=e.workspace_id and g.project_id is not distinct from e.project_id and e.repo_key=any(g.repo_keys))then raise exception 'Current source scope required';end if;
 if exists(select 1 from mobile_execution_capabilities where execution_id=e.id and revoked_at is null)then raise exception 'Capability already issued; no automatic replacement';end if;
 insert into mobile_execution_capabilities(execution_id,secret_hash,expires_at)values(e.id,p_hash,p_expires)returning id into c;
 return c;
end;$$;
create function public.mobile_capability_reserve(p_capability uuid,p_hash text,p_request uuid,p_quote text,p_max bigint)returns uuid language plpgsql security definer set search_path=public as $$
declare c mobile_execution_capabilities;e mobile_executions;
begin
 -- Same execution-first lock order as issuance/normal hold reservation.
 select x.* into e from mobile_executions x join mobile_execution_capabilities cap on cap.execution_id=x.id where cap.id=p_capability for update of x;
 if not found then raise exception 'Execution capability required';end if;
 select * into c from mobile_execution_capabilities where id=p_capability for update;
 if c.revoked_at is not null or c.expires_at<=now()or p_hash is null or c.secret_hash is distinct from p_hash then raise exception 'Capability expired or revoked';end if;
 if not exists(select 1 from mobile_task_proposals p join mobile_sessions s on s.id=p.session_id join mobile_grants g on g.device_id=s.device_id join devices d on d.id=g.device_id where p.id=e.proposal_id and p.project_id is not distinct from e.project_id and g.project_id is not distinct from e.project_id and d.revoked_at is null)then raise exception 'Current project/device scope required';end if;
 return mobile_model_reserve(e.id,p_request,p_quote,p_max);
end;$$;
revoke all on function public.mobile_capability_issue(uuid,text,timestamptz),public.mobile_capability_reserve(uuid,text,uuid,text,bigint)from public,anon,authenticated;
grant execute on function public.mobile_capability_issue(uuid,text,timestamptz),public.mobile_capability_reserve(uuid,text,uuid,text,bigint)to service_role;
commit;
