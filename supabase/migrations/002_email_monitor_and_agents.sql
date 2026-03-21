-- Email monitoring: track last check per user
alter table users add column if not exists email_monitor_enabled boolean default false;
alter table users add column if not exists email_last_checked_at timestamptz;

-- Persistent execution agents
create table if not exists execution_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  recipe_id uuid references recipes(id) on delete cascade,
  name text not null,
  history jsonb default '[]'::jsonb,       -- accumulated conversation history
  tool_call_log jsonb default '[]'::jsonb, -- all tool calls across runs
  run_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, recipe_id)
);

create index if not exists idx_execution_agents_user on execution_agents(user_id);
create index if not exists idx_execution_agents_recipe on execution_agents(recipe_id);

alter table execution_agents enable row level security;
create policy "agents_select_own" on execution_agents
  for select using (user_id = auth.uid());
create policy "agents_insert_own" on execution_agents
  for insert with check (user_id = auth.uid());
create policy "agents_update_own" on execution_agents
  for update using (user_id = auth.uid());

-- MCP server connections
create table if not exists mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  server_url text not null,
  auth_type text not null default 'none',     -- 'none' | 'api_key' | 'oauth'
  auth_config text,                            -- AES-256-GCM encrypted JSON
  discovered_tools jsonb default '[]'::jsonb,  -- cached tool definitions from server
  enabled boolean default true,
  last_connected_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_mcp_connections_user on mcp_connections(user_id, enabled);

alter table mcp_connections enable row level security;
create policy "mcp_select_own" on mcp_connections
  for select using (user_id = auth.uid());
create policy "mcp_insert_own" on mcp_connections
  for insert with check (user_id = auth.uid());
create policy "mcp_update_own" on mcp_connections
  for update using (user_id = auth.uid());
create policy "mcp_delete_own" on mcp_connections
  for delete using (user_id = auth.uid());
