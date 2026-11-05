-- DRAFT ONLY. Not applied. Mobile transport uses canonical conversations/messages.
-- Service RPCs are unavailable to anon/authenticated; routes authenticate paired
-- device then validate a separate owner-approved, revocable mobile grant.
begin;
alter table public.devices add column purpose text not null default 'home' check(purpose in('home','mobile'));
create table public.mobile_grants(
 device_id uuid primary key references public.devices(id),
 owner_id uuid not null references public.users(id),
 workspace_id uuid not null references public.workspaces(id),
 project_id uuid references public.projects(id),
 agent_key text not null, repo_keys text[] not null default '{}',
 inference_enabled boolean not null default false,
 revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.mobile_sessions(
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices(id),
 owner_id uuid not null references public.users(id),
 workspace_id uuid not null references public.workspaces(id),
 conversation_id uuid unique not null references public.conversations(id),
 project_id uuid references public.projects(id),agent_key text not null,
 repo_keys text[] not null default '{}',open_request_id uuid not null,
 unique(device_id,open_request_id)
);
create table public.mobile_turns(
 session_id uuid not null references public.mobile_sessions(id),request_id uuid not null,
 fingerprint text not null,status text not null check(status in('pending','complete','failed')),
 reply jsonb,created_at timestamptz not null default now(),finished_at timestamptz,
 primary key(session_id,request_id)
);
create unique index mobile_one_active_turn on public.mobile_turns(session_id) where status='pending';
-- Generic lock-screen notice outbox. Never carries source text, prompts or reply.
create table public.mobile_notices(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.mobile_sessions(id),
 request_id uuid not null,kind text not null check(kind in('reply_ready','turn_failed')),
 created_at timestamptz not null default now(),delivered_at timestamptz,
 unique(session_id,request_id,kind)
);
create table public.mobile_task_proposals(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.mobile_sessions(id),
 request_id uuid not null,ordinal integer not null check(ordinal between 0 and 3),
 owner_id uuid not null references public.users(id),workspace_id uuid not null references public.workspaces(id),
 project_id uuid references public.projects(id),proposal jsonb not null,
 status text not null default 'proposed' check(status in('proposed','approved','cancelled')),
 approved_digest text,approved_at timestamptz,created_at timestamptz not null default now(),
 unique(session_id,request_id,ordinal)
);
alter table public.mobile_task_proposals enable row level security;
revoke all on public.mobile_task_proposals from anon,authenticated;
alter table public.mobile_grants enable row level security;
alter table public.mobile_sessions enable row level security;
alter table public.mobile_turns enable row level security;
alter table public.mobile_notices enable row level security;
-- No direct mobile client access and no accidental existing device expansion.
revoke all on public.mobile_grants,public.mobile_sessions,public.mobile_turns,public.mobile_notices from anon,authenticated;
create function public.mobile_open(p_device uuid,p_owner uuid,p_workspace uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare g mobile_grants; s mobile_sessions; c uuid;
begin
 select * into g from mobile_grants where device_id=p_device and owner_id=p_owner and workspace_id=p_workspace and revoked_at is null for update;
 if not found then raise exception 'Mobile grant required';end if;
 if not exists(select 1 from devices where id=p_device and owner_id=p_owner and workspace_id=p_workspace and revoked_at is null and purpose='mobile')
 or not exists(select 1 from workspaces where id=p_workspace and owner_id=p_owner)
 or (g.project_id is not null and not exists(select 1 from projects where id=g.project_id and workspace_id=p_workspace)) then raise exception 'Invalid mobile principal';end if;
 select * into s from mobile_sessions where device_id=p_device and open_request_id=p_request;
 if found then return to_jsonb(s);end if;
 insert into conversations(workspace_id,owner_id,project_id,title,agent)values(p_workspace,p_owner,g.project_id,'T3 conversation',g.agent_key)returning id into c;
 insert into mobile_sessions(device_id,owner_id,workspace_id,conversation_id,project_id,agent_key,repo_keys,open_request_id)values(p_device,p_owner,p_workspace,c,g.project_id,g.agent_key,g.repo_keys,p_request)returning * into s;
 return to_jsonb(s);
end;$$;
create function public.mobile_claim(p_session uuid,p_device uuid,p_owner uuid,p_workspace uuid,p_request uuid,p_fingerprint text)returns jsonb language plpgsql security definer set search_path=public as $$
declare s mobile_sessions;t mobile_turns;
begin
 select * into s from mobile_sessions where id=p_session and device_id=p_device and owner_id=p_owner and workspace_id=p_workspace for update;
 if not found then raise exception 'Session not owned';end if;
 if not exists(select 1 from mobile_grants where device_id=p_device and owner_id=p_owner and workspace_id=p_workspace and revoked_at is null and inference_enabled and agent_key=s.agent_key and project_id is not distinct from s.project_id and repo_keys @> s.repo_keys)
 or not exists(select 1 from devices where id=p_device and revoked_at is null and purpose='mobile')then raise exception 'Inference grant required';end if;
 select * into t from mobile_turns where session_id=p_session and request_id=p_request;
 if found then
 if t.fingerprint<>p_fingerprint then raise exception 'Idempotency conflict';end if;
 return jsonb_build_object('status',t.status,'result',t.reply);
 end if;
 if exists(select 1 from mobile_turns where session_id=p_session and status='pending')then return jsonb_build_object('status','busy');end if;
 insert into mobile_turns(session_id,request_id,fingerprint,status)values(p_session,p_request,p_fingerprint,'pending');
 return jsonb_build_object('status','claimed');
end;$$;
create function public.mobile_complete(p_session uuid,p_device uuid,p_owner uuid,p_workspace uuid,p_request uuid,p_fingerprint text,p_user text,p_assistant text,p_reply jsonb)returns void language plpgsql security definer set search_path=public as $$
declare s mobile_sessions;t mobile_turns;
begin
 select * into s from mobile_sessions where id=p_session and device_id=p_device and owner_id=p_owner and workspace_id=p_workspace for update;
 if not found then raise exception 'Session not owned';end if;
 select * into t from mobile_turns where session_id=p_session and request_id=p_request and fingerprint=p_fingerprint and status='pending' for update;
 if not found then raise exception 'Turn not pending';end if;
 if not exists(select 1 from mobile_grants where device_id=p_device and owner_id=p_owner and workspace_id=p_workspace and revoked_at is null and inference_enabled and agent_key=s.agent_key and project_id is not distinct from s.project_id and repo_keys @> s.repo_keys) or not exists(select 1 from devices where id=p_device and revoked_at is null and purpose='mobile') then raise exception 'Mobile grant revoked or narrowed';end if;
 if jsonb_typeof(coalesce(p_reply->'proposals','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_reply->'proposals','[]'::jsonb))>4 then raise exception 'Invalid proposal envelope';end if;
 insert into mobile_task_proposals(session_id,request_id,ordinal,owner_id,workspace_id,project_id,proposal)
 select p_session,p_request,(x.ordinality-1)::integer,p_owner,p_workspace,s.project_id,x.value from jsonb_array_elements(coalesce(p_reply->'proposals','[]'::jsonb))with ordinality as x(value,ordinality);
 insert into messages(conversation_id,role,content,agent,meta,created_at)values(s.conversation_id,'user',p_user,s.agent_key,jsonb_build_object('mobileRequestId',p_request),now()),(s.conversation_id,'assistant',p_assistant,s.agent_key,jsonb_build_object('mobileRequestId',p_request,'contextVersion',p_reply->>'contextVersion'),now()+interval '1 microsecond');
 insert into memory_items(workspace_id,owner_id,project_id,scope,type,content,conversation_id)values(p_workspace,p_owner,s.project_id,'conversation','conversation',left('User: '||p_user||E'\nAssistant: '||p_assistant,3000),s.conversation_id);
 update conversations set preview=left(p_assistant,400),updated_at=now() where id=s.conversation_id;
 update mobile_turns set status='complete',reply=p_reply,finished_at=now()where session_id=p_session and request_id=p_request;
 insert into mobile_notices(session_id,request_id,kind)values(p_session,p_request,'reply_ready')on conflict do nothing;
end;$$;
revoke all on function public.mobile_open(uuid,uuid,uuid,uuid),public.mobile_claim(uuid,uuid,uuid,uuid,uuid,text),public.mobile_complete(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)from public,anon,authenticated;
grant execute on function public.mobile_open(uuid,uuid,uuid,uuid),public.mobile_claim(uuid,uuid,uuid,uuid,uuid,text),public.mobile_complete(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)to service_role;
create function public.mobile_ack_notice(p_session uuid,p_device uuid,p_owner uuid,p_workspace uuid,p_notice uuid)returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from mobile_sessions s join mobile_grants g on g.device_id=s.device_id join devices d on d.id=s.device_id where s.id=p_session and s.device_id=p_device and s.owner_id=p_owner and s.workspace_id=p_workspace and g.revoked_at is null and d.revoked_at is null and g.owner_id=p_owner and g.workspace_id=p_workspace) then raise exception 'Session not owned';end if;
 update mobile_notices set delivered_at=coalesce(delivered_at,now())where id=p_notice and session_id=p_session;
 return found;
end;$$;
revoke all on function public.mobile_ack_notice(uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.mobile_ack_notice(uuid,uuid,uuid,uuid,uuid)to service_role;
commit;
