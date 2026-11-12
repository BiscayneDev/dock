-- FICTIONAL proof fixture. Minimal stand-ins for the tenancy and message tables, plus the real 0020 Beacon functions (lines 31-66) copied in.
create table workspaces(id uuid primary key,owner_id uuid);
create table devices(id uuid primary key,owner_id uuid,revoked_at timestamptz);
create table mobile_grants(device_id uuid primary key,owner_id uuid,workspace_id uuid,project_id uuid,agent_key text,repo_keys text[] default '{}',revoked_at timestamptz);
create table mobile_sessions(id uuid primary key,device_id uuid,owner_id uuid,workspace_id uuid,conversation_id uuid,project_id uuid,agent_key text,repo_keys text[] default '{}');
create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,role text,content text,agent text,meta jsonb);
create table memory_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,project_id uuid,scope text,type text,content text,created_at timestamptz default now(),
 visibility text not null default 'personal',author_agent text,private_execution_id uuid,memory_state text not null default 'active',source_memory_id uuid,source_reference text,promoted_memory_id uuid,approved_by uuid,approved_at timestamptz);
create table memory_business_members(workspace_id uuid,user_id uuid,role text,revoked_at timestamptz);
create table memory_agent_assignments(id uuid primary key default gen_random_uuid(),workspace_id uuid,project_id uuid,agent_key text,revoked_at timestamptz);
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
