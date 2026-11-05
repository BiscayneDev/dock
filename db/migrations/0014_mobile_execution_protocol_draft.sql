-- DRAFT ONLY, not applied. Service-role execution protocol; no chat approval.
begin;
alter table public.mobile_executions add column approved_text text not null default '';
alter table public.mobile_executions add column decision_expires_at timestamptz;
alter table public.mobile_executions add column source_paths text[] not null default '{}';
alter table public.mobile_executions add column last_operational_state text;
alter table public.mobile_executions add column cleanup_lease_until timestamptz;
alter table public.mobile_executions add column result_recorded_at timestamptz;
create function public.mobile_execution_transition(p_execution uuid,p_expected text,p_next text,p_details jsonb default '{}')returns boolean language plpgsql security definer set search_path=public as $$
declare e mobile_executions;
begin
 select * into e from mobile_executions where id=p_execution for update;
 if not found or e.state<>p_expected then return false;end if;
 if not ((p_expected='approved' and p_next='provision_intent')or(p_expected='provision_intent' and p_next='bound')or(p_expected='bound' and p_next='start_intent')or(p_expected='start_intent' and p_next='running')or(p_expected in('provision_intent','bound','start_intent','running')and p_next='reconcile'))then raise exception 'Invalid execution transition';end if;
 if p_next='provision_intent' and not exists(select 1 from mobile_task_proposals p join mobile_sessions s on s.id=p.session_id join mobile_grants g on g.device_id=s.device_id where p.id=e.proposal_id and p.owner_id=e.owner_id and p.workspace_id=e.workspace_id and p.project_id is not distinct from e.project_id and p.status='approved'and p.approved_digest=e.approved_proposal_digest and g.owner_id=e.owner_id and g.workspace_id=e.workspace_id and g.revoked_at is null and e.repo_key=any(g.repo_keys))then raise exception 'Decision revoked or source grant changed';end if;
 if p_next='provision_intent' and(not e.lifecycle_approved or e.decision_expires_at is null or e.decision_expires_at<=now() or e.cleanup_deadline<=now()or length(e.approved_text)=0 or cardinality(e.source_paths)=0)then raise exception 'Current complete decision required';end if;
 if p_next='bound' and(length(coalesce(p_details->>'instanceId',''))=0 or e.instance_id is not null)then raise exception 'Instance binding required';end if;
 if p_next='running' and(length(coalesce(p_details->>'runId',''))=0 or length(coalesce(p_details->>'threadId',''))=0)then raise exception 'Run binding required';end if;
 update mobile_executions set state=p_next,instance_id=case when p_next='bound'then p_details->>'instanceId'else instance_id end,thread_id=case when p_next='running'then p_details->>'threadId'else thread_id end,run_id=case when p_next='running'then p_details->>'runId'else run_id end,last_operational_state=case when p_next='reconcile'then p_expected else last_operational_state end,updated_at=now()where id=p_execution;
 insert into mobile_execution_events(execution_id,kind,details)values(p_execution,p_next,p_details);
 return true;
end;$$;
create function public.mobile_execution_result(p_execution uuid,p_instance text,p_run text,p_text text,p_success boolean)returns boolean language plpgsql security definer set search_path=public as $$
declare e mobile_executions;p mobile_task_proposals;s mobile_sessions;
begin
 select * into e from mobile_executions where id=p_execution for update;
 if not found or e.instance_id is distinct from p_instance or e.run_id is distinct from p_run then raise exception 'Execution result binding mismatch';end if;
 if e.result_recorded_at is not null then return false;end if;
 if e.state not in('running','reconcile')or p_text is null or length(p_text)>200000 then raise exception 'Invalid result state';end if;
 select * into p from mobile_task_proposals where id=e.proposal_id;
 select * into s from mobile_sessions where id=p.session_id and owner_id=e.owner_id and workspace_id=e.workspace_id;
 if not found then raise exception 'Canonical conversation not owned';end if;
 insert into messages(conversation_id,role,content,agent,meta)values(s.conversation_id,'agent',p_text,e.agent_key,jsonb_build_object('executionId',e.id,'parentExecutionId',e.parent_execution_id,'success',p_success));
 -- Result is returned to its owner conversation, not auto-promoted into
 -- personal recall where a sibling could inherit private execution output.
 insert into mobile_notices(session_id,request_id,kind)values(s.id,e.id,case when p_success then'reply_ready'else'turn_failed'end)on conflict do nothing;
 update mobile_executions set result=p_text,result_recorded_at=now(),state='cleanup_pending',last_operational_state=case when p_success then'complete'else'failed'end,updated_at=now()where id=e.id;
 insert into mobile_execution_events(execution_id,kind,details)values(e.id,'result_recorded',jsonb_build_object('success',p_success));
 return true;
end;$$;
create function public.mobile_cleanup_claim(p_execution uuid)returns boolean language plpgsql security definer set search_path=public as $$
begin
 update mobile_executions set cleanup_lease_until=now()+interval '2 minutes',cleanup_attempts=cleanup_attempts+1,updated_at=now()where id=p_execution and instance_id is not null and lifecycle_approved and state<>'cleanup_confirmed'and(cleanup_deadline<=now()or state='cleanup_pending')and(cleanup_lease_until is null or cleanup_lease_until<=now());return found;
end;$$;
revoke all on function public.mobile_execution_transition(uuid,text,text,jsonb),public.mobile_execution_result(uuid,text,text,text,boolean),public.mobile_cleanup_claim(uuid)from public,anon,authenticated;
grant execute on function public.mobile_execution_transition(uuid,text,text,jsonb),public.mobile_execution_result(uuid,text,text,text,boolean),public.mobile_cleanup_claim(uuid)to service_role;
commit;
