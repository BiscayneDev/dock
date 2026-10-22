-- Onboarding answers per workspace (ten steps) and the workspace rules list.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * One profile row per workspace. Each answer has a choice column (slug), an optional
--     free-text "_other" column for "Something else", and a "_skipped" flag. A skipped answer
--     is stored as null with skipped = true: the agent may infer it later, and no value is invented.
--   * RLS on both tables, owner-only (the workspace's owner_id = auth.uid()).

begin;

create table if not exists public.workspace_profile (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,

  -- 1. Goal (required at this step): what is being built, in one sentence.
  goal text check (char_length(goal) <= 300),
  goal_skipped boolean not null default false,

  -- 2. Source: 'blank' or 'github'. The GitHub import is not built yet (TODO hook in the app).
  source_choice text check (source_choice in ('blank', 'github')),
  source_repo text check (char_length(source_repo) <= 200),
  source_skipped boolean not null default false,

  -- 3. Story: why it is being built.
  story_choice text check (story_choice in ('own_frustration', 'agent_infra', 'friends_asked', 'something_else')),
  story_other text check (char_length(story_other) <= 500),
  story_skipped boolean not null default false,

  -- 4. Stage.
  stage_choice text check (stage_choice in ('just_me', 'few_users', 'nobody_yet', 'something_else')),
  stage_other text check (char_length(stage_other) <= 300),
  stage_skipped boolean not null default false,

  -- 5. Direction.
  direction_choice text check (direction_choice in ('carry_on', 'narrow', 'rethink', 'something_else')),
  direction_other text check (char_length(direction_other) <= 500),
  direction_skipped boolean not null default false,

  -- 6. First paying customer.
  customer_choice text check (customer_choice in ('busy_professional', 'small_business_owner', 'solo_founder', 'something_else')),
  customer_other text check (char_length(customer_other) <= 300),
  customer_skipped boolean not null default false,

  -- 7. Pricing and payments.
  pricing_model text check (pricing_model in ('subscription', 'usage_based', 'free_then_paid', 'something_else')),
  pricing_other text check (char_length(pricing_other) <= 300),
  payment_method text check (payment_method in ('usdc', 'card', 'both')),
  pricing_skipped boolean not null default false,

  -- 8. Acquisition: how the first hundred users hear about it.
  acquisition_choice text check (acquisition_choice in ('founder_social', 'friends_referrals', 'paid_ads', 'communities', 'something_else')),
  acquisition_other text check (char_length(acquisition_other) <= 300),
  acquisition_skipped boolean not null default false,

  -- 9. Rules: the list lives in workspace_rules. This flag records a skipped step.
  rules_skipped boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Preset key for the four default rules; null for "Add your own".
  preset_key text check (preset_key in ('no_spend_without_approval', 'no_public_post_without_approval', 'no_private_data_outside_workspace', 'no_pricing_change_without_asking')),
  text text not null check (char_length(text) between 1 and 300),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists workspace_rules_workspace_idx on public.workspace_rules (workspace_id);

alter table public.workspace_profile enable row level security;
alter table public.workspace_rules enable row level security;

drop policy if exists workspace_profile_all_owner on public.workspace_profile;
create policy workspace_profile_all_owner on public.workspace_profile for all to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())));

drop policy if exists workspace_rules_all_owner on public.workspace_rules;
create policy workspace_rules_all_owner on public.workspace_rules for all to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())));

commit;

notify pgrst, 'reload schema';
