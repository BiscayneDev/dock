-- Venture mode: per-venture onboarding answers, and rules that belong to one venture.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * A venture is a row in public.projects. Its answers live in public.venture_profile (one row per
--     project, same columns as workspace_profile). Its rules live in workspace_rules with project_id set.
--   * Rows with project_id null are workspace-level (first-run onboarding). Nothing existing changes.
--   * RLS on venture_profile, owner-only (the workspace's owner_id = auth.uid()), same as the others.

begin;

create table if not exists public.venture_profile (
  project_id uuid primary key references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  goal text check (char_length(goal) <= 300),
  goal_skipped boolean not null default false,

  source_choice text check (source_choice in ('blank', 'github')),
  source_repo text check (char_length(source_repo) <= 200),
  source_skipped boolean not null default false,

  story_choice text check (story_choice in ('own_frustration', 'agent_infra', 'friends_asked', 'something_else')),
  story_other text check (char_length(story_other) <= 500),
  story_skipped boolean not null default false,

  stage_choice text check (stage_choice in ('just_me', 'few_users', 'nobody_yet', 'something_else')),
  stage_other text check (char_length(stage_other) <= 300),
  stage_skipped boolean not null default false,

  direction_choice text check (direction_choice in ('carry_on', 'narrow', 'rethink', 'something_else')),
  direction_other text check (char_length(direction_other) <= 500),
  direction_skipped boolean not null default false,

  customer_choice text check (customer_choice in ('busy_professional', 'small_business_owner', 'solo_founder', 'something_else')),
  customer_other text check (char_length(customer_other) <= 300),
  customer_skipped boolean not null default false,

  pricing_model text check (pricing_model in ('subscription', 'usage_based', 'free_then_paid', 'something_else')),
  pricing_other text check (char_length(pricing_other) <= 300),
  payment_method text check (payment_method in ('usdc', 'card', 'both')),
  pricing_skipped boolean not null default false,

  acquisition_choice text check (acquisition_choice in ('founder_social', 'friends_referrals', 'paid_ads', 'communities', 'something_else')),
  acquisition_other text check (char_length(acquisition_other) <= 300),
  acquisition_skipped boolean not null default false,

  rules_skipped boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists venture_profile_workspace_idx on public.venture_profile (workspace_id);

-- Rules: null project_id = workspace rules (first-run). Set = rules for that venture only.
alter table public.workspace_rules
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists workspace_rules_project_idx on public.workspace_rules (project_id);

alter table public.venture_profile enable row level security;

drop policy if exists venture_profile_all_owner on public.venture_profile;
create policy venture_profile_all_owner on public.venture_profile for all to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())));

commit;

notify pgrst, 'reload schema';
