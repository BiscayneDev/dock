-- DRAFT ONLY. Per-execution capability tools, no model-held owner/admin key.
begin;
create function beacon_execution_memory(p_capability uuid,p_hash text,p_operation text,p_content text,p_note uuid default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare e mobile_executions;c mobile_execution_capabilities;n memory_items;result_id uuid;result jsonb;
begin
 select x.*into e from mobile_executions x join mobile_execution_capabilities cap on cap.execution_id=x.id where cap.id=p_capability for update of x;
 if not found then raise exception 'Current execution capability required';end if;
 select *into c from mobile_execution_capabilities where id=p_capability for update;
 if c.revoked_at is not null or c.expires_at<=now()or c.secret_hash is distinct from p_hash or p_hash is null then raise exception 'Capability expired/revoked';end if;
 -- Reuses the exact source decision/device/project checks, before every tool.
 perform 1 from beacon_execution_recall(e.id,'',1);
 if p_operation='recall'then select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)into result from beacon_execution_recall(e.id,left(p_content,1000),8)r;return result;end if;
 if p_content is null or length(trim(p_content))not between 1 and 2000 then raise exception 'Bound memory content required';end if;
 if p_operation='note'then
  insert into memory_items(owner_id,workspace_id,project_id,scope,type,content,visibility,author_agent,private_execution_id,source_reference)values(e.owner_id,e.workspace_id,e.project_id,'fact','fact',p_content,'agent',e.agent_key,e.id,'execution:'||e.id)returning id into result_id;
 elsif p_operation='distill'then
  select *into n from memory_items where id=p_note and owner_id=e.owner_id and workspace_id=e.workspace_id and project_id is not distinct from e.project_id and visibility='agent'and memory_state='active'and author_agent=e.agent_key and private_execution_id=e.id;
  if not found then raise exception 'Own private source note required';end if;
  insert into memory_items(owner_id,workspace_id,project_id,scope,type,content,visibility,author_agent,private_execution_id,memory_state,source_memory_id,source_reference)values(e.owner_id,e.workspace_id,e.project_id,'fact','fact',p_content,'agent',e.agent_key,e.id,'proposed',n.id,'execution:'||e.id)returning id into result_id;
 else raise exception 'Unsupported memory operation';end if;
 return jsonb_build_object('id',result_id,'shared',false);
end;$$;
revoke all on function beacon_execution_memory(uuid,text,text,text,uuid)from public,anon,authenticated;
grant execute on function beacon_execution_memory(uuid,text,text,text,uuid)to service_role;
commit;
