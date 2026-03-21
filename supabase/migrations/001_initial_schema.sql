-- Dock: Initial database schema
-- Run this in the Supabase SQL Editor

-- ============================================
-- TABLES
-- ============================================

create table users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  telegram_username text,
  name text,
  timezone text default 'UTC',
  quiet_hours_start time,
  quiet_hours_end time,
  daily_briefing boolean default false,
  created_at timestamptz default now()
);

create table oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  provider text not null,
  access_token text not null,       -- AES-256-GCM encrypted JSON
  refresh_token text,               -- AES-256-GCM encrypted JSON
  expires_at timestamptz,
  scopes text[],
  provider_account_id text,
  provider_account_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, provider)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  role text not null,               -- 'user' | 'assistant' | 'tool'
  content text,
  tool_calls jsonb,
  tool_results jsonb,
  telegram_message_id bigint,
  created_at timestamptz default now()
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  message text not null,
  fire_at timestamptz not null,
  fired boolean default false,
  created_at timestamptz default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  description text,
  instructions text not null,
  trigger_type text not null,       -- 'schedule' | 'email_event' | 'github_event' | 'notion_event' | 'keyword' | 'manual'
  trigger_config jsonb not null,
  enabled boolean default true,
  notify_on_run boolean default true,
  last_run_at timestamptz,
  last_checked_at timestamptz,
  run_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table recipe_runs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references recipes(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  triggered_at timestamptz default now(),
  completed_at timestamptz,
  trigger_context jsonb,
  status text default 'running',    -- 'running' | 'success' | 'failed' | 'skipped' | 'test'
  output text,
  tool_calls jsonb,
  error text,
  duration_ms integer
);

create table recipe_templates (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  category text,                    -- 'Email' | 'Calendar' | 'GitHub' | 'Notion' | 'Productivity'
  required_integrations text[],
  trigger_type text not null,
  trigger_config jsonb not null,
  instructions text not null,
  preview_output text
);

-- ============================================
-- INDEXES
-- ============================================

create index idx_messages_user_created on messages(user_id, created_at desc);
create index idx_reminders_fire_at on reminders(fire_at) where fired = false;
create index idx_recipes_user_enabled on recipes(user_id, enabled);
create index idx_recipes_trigger_checked on recipes(trigger_type, last_checked_at) where enabled = true;
create index idx_recipe_runs_recipe on recipe_runs(recipe_id, triggered_at desc);
create index idx_recipe_runs_user on recipe_runs(user_id, triggered_at desc);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table users enable row level security;
alter table oauth_tokens enable row level security;
alter table messages enable row level security;
alter table reminders enable row level security;
alter table recipes enable row level security;
alter table recipe_runs enable row level security;
alter table recipe_templates enable row level security;

-- Users: access own row by telegram_id
-- Note: RLS policies use auth.uid() for Supabase Auth.
-- Since we use service_role key for server operations and Telegram auth
-- (not Supabase Auth), these policies are for defense-in-depth.
-- Server operations bypass RLS via the service_role key.
create policy "users_select_own" on users
  for select using (id = auth.uid());
create policy "users_update_own" on users
  for update using (id = auth.uid());

-- OAuth tokens: access own tokens
create policy "tokens_select_own" on oauth_tokens
  for select using (user_id = auth.uid());
create policy "tokens_insert_own" on oauth_tokens
  for insert with check (user_id = auth.uid());
create policy "tokens_update_own" on oauth_tokens
  for update using (user_id = auth.uid());
create policy "tokens_delete_own" on oauth_tokens
  for delete using (user_id = auth.uid());

-- Messages: access own messages
create policy "messages_select_own" on messages
  for select using (user_id = auth.uid());
create policy "messages_insert_own" on messages
  for insert with check (user_id = auth.uid());
create policy "messages_delete_own" on messages
  for delete using (user_id = auth.uid());

-- Reminders: access own reminders
create policy "reminders_select_own" on reminders
  for select using (user_id = auth.uid());
create policy "reminders_insert_own" on reminders
  for insert with check (user_id = auth.uid());
create policy "reminders_update_own" on reminders
  for update using (user_id = auth.uid());
create policy "reminders_delete_own" on reminders
  for delete using (user_id = auth.uid());

-- Recipes: access own recipes
create policy "recipes_select_own" on recipes
  for select using (user_id = auth.uid());
create policy "recipes_insert_own" on recipes
  for insert with check (user_id = auth.uid());
create policy "recipes_update_own" on recipes
  for update using (user_id = auth.uid());
create policy "recipes_delete_own" on recipes
  for delete using (user_id = auth.uid());

-- Recipe runs: access own runs
create policy "recipe_runs_select_own" on recipe_runs
  for select using (user_id = auth.uid());
create policy "recipe_runs_insert_own" on recipe_runs
  for insert with check (user_id = auth.uid());
create policy "recipe_runs_update_own" on recipe_runs
  for update using (user_id = auth.uid());

-- Recipe templates: readable by everyone (public gallery)
create policy "templates_select_all" on recipe_templates
  for select using (true);
