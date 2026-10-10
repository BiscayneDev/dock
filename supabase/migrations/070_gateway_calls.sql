-- One row per gateway call, including failures and timeouts. Additive only.
-- (inference_usage stays the billing/spend record and only has successes.)
create table if not exists public.dinghy_gateway_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  chat_guid text,
  source text not null,                 -- chat | tool_loop | synthesis
  iteration integer,
  requested_model text,
  resolved_model text,
  provider text,
  tier text,
  outcome text not null check (outcome in ('ok', 'deadline', 'http_error', 'error')),
  http_status integer,
  input_tokens integer,
  cached_tokens integer,
  output_tokens integer,
  latency_ms integer not null,
  cost_usd numeric,
  tools_offered integer,
  prompt_chars integer,
  private_route boolean not null default false,
  deadline_left_ms integer
);
create index if not exists dinghy_gateway_calls_created_idx on public.dinghy_gateway_calls (created_at desc);
create index if not exists dinghy_gateway_calls_model_idx on public.dinghy_gateway_calls (resolved_model, created_at desc);
alter table public.dinghy_gateway_calls enable row level security;
revoke all on public.dinghy_gateway_calls from anon, authenticated, public;
grant select, insert on public.dinghy_gateway_calls to service_role;
grant usage, select on sequence public.dinghy_gateway_calls_id_seq to service_role;
