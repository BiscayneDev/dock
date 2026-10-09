-- Metadata-only breadcrumbs. No conversation bodies or tool arguments/results.
create table public.dinghy_run_stages (
    id bigint generated always as identity primary key,
    run_id uuid not null,
    chat_guid text not null,
    message_id text,
    stage text not null check (stage in ('context','gateway','tool','synthesis','reply_ready','reply_attempted','deadline','failed')),
    detail text check (length(detail) <= 80),
    created_at timestamptz not null default now()
);
create index dinghy_run_stages_run on public.dinghy_run_stages(run_id, created_at);
create index dinghy_run_stages_time on public.dinghy_run_stages(created_at);
alter table public.dinghy_run_stages enable row level security;
revoke all on public.dinghy_run_stages from anon, authenticated;
grant select, insert on public.dinghy_run_stages to service_role;
grant usage, select on sequence public.dinghy_run_stages_id_seq to service_role;
comment on table public.dinghy_run_stages is 'Restricted diagnostic metadata; no content. Retention cleanup must be configured before sustained production use.';
