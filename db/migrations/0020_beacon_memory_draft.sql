-- DRAFT ONLY. Existing canonical memory store, Beacon recall/distill/promote.
-- Legacy rows remain personal. No automatic sharing or cross-product DB link.
begin;
alter table memory_items add column visibility text not null default 'personal'check(visibility in('personal','business','agent'));
alter table memory_items add column author_agent text;
alter table memory_items add column private_execution_id uuid references mobile_executions(id);
alter table memory_items add column memory_state text not null default 'active'check(memory_state in('active','proposed','approved','rejected'));
alter table memory_items add column source_memory_id uuid references memory_items(id);
alter table memory_items add column source_reference text;
-- Lineage stays on private candidate, never on member-readable business rows.
alter table memory_items add column promoted_memory_id uuid references memory_items(id);
alter table memory_items add constraint beacon_business_no_private_lineage check(visibility<>'business'or(source_memory_id is null and source_reference is null and author_agent is null and promoted_memory_id is null and private_execution_id is null));
alter table memory_items add column approved_by uuid references users(id);
alter table memory_items add column approved_at timestamptz;
alter table memory_items add constraint beacon_private_agent_named check(visibility<>'agent'or author_agent is not null);
alter table memory_items add constraint beacon_business_approved check(visibility<>'business'or(memory_state='approved'and approved_by is not null and approved_at is not null));
create table memory_business_members(workspace_id uuid not null references workspaces(id),user_id uuid not null references users(id),role text not null check(role in('admin','member')),revoked_at timestamptz,primary key(workspace_id,user_id));
create table memory_agent_assignments(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid references projects(id),agent_key text not null,revoked_at timestamptz);
create unique index memory_agent_assignment_unique on memory_agent_assignments(workspace_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),agent_key);
alter table memory_business_members enable row level security;alter table memory_agent_assignments enable row level security;
revoke all on memory_business_members,memory_agent_assignments from anon,authenticated;
-- RLS keeps private rows with their owner; shared approved facts visible only to
-- current business members. Agent workloads use the bound service RPC below.
drop policy if exists memory_items_all_owner on memory_items;
create function beacon_session_read(p_owner uuid,p_workspace uuid,p_visibility text,p_state text)returns boolean language sql stable security definer set search_path=public as $$
 select p_owner=auth.uid()or(p_visibility='business'and p_state='approved'and exists(select 1 from memory_business_members where workspace_id=p_workspace and user_id=auth.uid()and revoked_at is null));
$$;
revoke all on function beacon_session_read(uuid,uuid,text,text)from public,anon;grant execute on function beacon_session_read(uuid,uuid,text,text)to authenticated,service_role;
create policy memory_items_beacon_read on memory_items for select to authenticated using(beacon_session_read(owner_id,workspace_id,visibility,memory_state));
-- Direct client writes denied: note/proposal/promotion functions own transitions.
create function beacon_mobile_identity(p_device uuid,p_owner uuid,p_workspace uuid,p_project uuid,p_agent text)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from mobile_grants g join devices d on d.id=g.device_id join workspaces w on w.id=g.workspace_id where g.device_id=p_device and g.owner_id=p_owner and g.workspace_id=p_workspace and g.project_id is not distinct from p_project and g.agent_key=p_agent and g.revoked_at is null and d.revoked_at is null and d.owner_id=p_owner and w.owner_id=p_owner);
$$;
create function beacon_mobile_recall(p_device uuid,p_owner uuid,p_workspace uuid,p_project uuid,p_agent text,p_query text,p_limit int default 8)returns setof memory_items language plpgsql security definer set search_path=public as $$
begin
 if not beacon_mobile_identity(p_device,p_owner,p_workspace,p_project,p_agent)then raise exception 'Current bound memory identity required';end if;
 return query select m.*from memory_items m where m.owner_id=p_owner and m.workspace_id=p_workspace and(m.project_id is null or m.project_id=p_project)and(
 (m.visibility='personal'and m.memory_state='active')or(m.visibility='agent'and m.author_agent=p_agent and m.private_execution_id is null and m.memory_state='active')or
 (m.visibility='business'and m.memory_state='approved'and exists(select 1 from memory_agent_assignments a where a.workspace_id=p_workspace and a.project_id is not distinct from m.project_id and a.agent_key=p_agent and a.revoked_at is null)))
 and(coalesce(trim(p_query),'')=''or m.content ilike '%'||left(p_query,200)||'%'or to_tsvector('english',m.content)@@websearch_to_tsquery('english',left(p_query,1000)))
 order by m.created_at desc limit greatest(1,least(p_limit,20));
end;$$;
create function beacon_mobile_note(p_device uuid,p_owner uuid,p_workspace uuid,p_project uuid,p_agent text,p_content text,p_source text)returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;
begin
 if not beacon_mobile_identity(p_device,p_owner,p_workspace,p_project,p_agent)or p_content is null or length(trim(p_content))not between 1 and 4000 or p_source is null or length(p_source)not between 1 and 500 then raise exception 'Current bound private note required';end if;
 insert into memory_items(owner_id,workspace_id,project_id,scope,type,content,visibility,author_agent,source_reference)values(p_owner,p_workspace,p_project,'fact','fact',p_content,'agent',p_agent,p_source)returning id into n;return n;
end;$$;
create function beacon_mobile_distill(p_device uuid,p_owner uuid,p_workspace uuid,p_project uuid,p_agent text,p_note uuid,p_content text)returns uuid language plpgsql security definer set search_path=public as $$
declare n memory_items;c uuid;
begin
 if not beacon_mobile_identity(p_device,p_owner,p_workspace,p_project,p_agent)then raise exception 'Current bound memory identity required';end if;
 select * into n from memory_items where id=p_note and owner_id=p_owner and workspace_id=p_workspace and project_id is not distinct from p_project and visibility='agent'and author_agent=p_agent and private_execution_id is null and memory_state='active';
 if not found or p_content is null or length(trim(p_content))not between 1 and 4000 then raise exception 'Private source note required';end if;
 insert into memory_items(owner_id,workspace_id,project_id,scope,type,content,visibility,author_agent,memory_state,source_memory_id,source_reference)values(p_owner,p_workspace,p_project,'fact','fact',p_content,'agent',p_agent,'proposed',n.id,n.source_reference)returning id into c;return c;
end;$$;
create function beacon_promote(p_candidate uuid,p_actor uuid,p_content text)returns uuid language plpgsql security definer set search_path=public as $$
declare c memory_items;b uuid;
begin
 select * into c from memory_items where id=p_candidate for update;
 if not found or c.visibility<>'agent'or c.memory_state<>'proposed'or c.source_memory_id is null or c.content is distinct from p_content then raise exception 'Exact current distilled candidate required';end if;
 if not exists(select 1 from workspaces where id=c.workspace_id and owner_id=p_actor)and not exists(select 1 from memory_business_members where workspace_id=c.workspace_id and user_id=p_actor and role='admin'and revoked_at is null)then raise exception 'Business owner/admin decision required';end if;
 if c.project_id is not null and not exists(select 1 from projects where id=c.project_id and workspace_id=c.workspace_id)then raise exception 'Project scope changed';end if;
 insert into memory_items(owner_id,workspace_id,project_id,scope,type,content,visibility,author_agent,memory_state,source_memory_id,source_reference,approved_by,approved_at)values(c.owner_id,c.workspace_id,c.project_id,'fact',c.type,c.content,'business',null,'approved',null,null,p_actor,now())returning id into b;
 update memory_items set memory_state='approved',promoted_memory_id=b,approved_by=p_actor,approved_at=now()where id=c.id;return b;
end;$$;
revoke all on function beacon_mobile_identity(uuid,uuid,uuid,uuid,text),beacon_mobile_recall(uuid,uuid,uuid,uuid,text,text,int),beacon_mobile_note(uuid,uuid,uuid,uuid,text,text,text),beacon_mobile_distill(uuid,uuid,uuid,uuid,text,uuid,text),beacon_promote(uuid,uuid,text)from public,anon,authenticated;
grant execute on function beacon_mobile_recall(uuid,uuid,uuid,uuid,text,text,int),beacon_mobile_note(uuid,uuid,uuid,uuid,text,text,text),beacon_mobile_distill(uuid,uuid,uuid,uuid,text,uuid,text),beacon_promote(uuid,uuid,text)to service_role;

-- A child/specialist obtains identity from its durable execution, never from a
-- prompt-supplied agent id. Only approved business facts and its own notes.
create function beacon_execution_recall(p_execution uuid,p_query text,p_limit int default 8)returns setof memory_items language plpgsql security definer set search_path=public as $$
declare e mobile_executions;
begin
 select * into e from mobile_executions where id=p_execution;
 if not found or e.state not in('bound','start_intent','running')or e.decision_expires_at<=now()or e.decision_expires_at is null or e.cleanup_deadline<=now()then raise exception 'Current exact execution memory identity required';end if;
 if not exists(select 1 from mobile_task_proposals p join mobile_sessions s on s.id=p.session_id join mobile_grants g on g.device_id=s.device_id join devices d on d.id=g.device_id where p.id=e.proposal_id and p.owner_id=e.owner_id and p.workspace_id=e.workspace_id and p.status='approved'and p.approved_digest=e.approved_proposal_digest and g.revoked_at is null and d.revoked_at is null and g.project_id is not distinct from e.project_id and e.repo_key=any(g.repo_keys))then raise exception 'Current source decision required';end if;
 return query select m.*from memory_items m where m.owner_id=e.owner_id and m.workspace_id=e.workspace_id and(m.project_id is null or m.project_id=e.project_id)and(
 (m.visibility='personal'and m.memory_state='active')or(m.visibility='agent'and m.author_agent=e.agent_key and m.private_execution_id=e.id and m.memory_state='active')or
 (m.visibility='business'and m.memory_state='approved'and exists(select 1 from memory_agent_assignments a where a.workspace_id=e.workspace_id and a.project_id is not distinct from m.project_id and a.agent_key=e.agent_key and a.revoked_at is null)))
 and(coalesce(trim(p_query),'')=''or m.content ilike '%'||left(p_query,200)||'%'or to_tsvector('english',m.content)@@websearch_to_tsquery('english',left(p_query,1000)))order by m.created_at desc limit greatest(1,least(p_limit,20));
end;$$;
revoke all on function beacon_execution_recall(uuid,text,int)from public,anon,authenticated;
grant execute on function beacon_execution_recall(uuid,text,int)to service_role;
commit;
