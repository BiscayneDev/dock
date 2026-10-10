-- 24h cache of resolved places for the places lookup (OSM usage policy: no
-- repeat geocoding of the same query). The key is a SHA-256 of the normalised
-- search text, never the text. Rows hold only the resolved place's coordinates
-- and display label. Street-address lookups (likely a home or work address)
-- are never written. Rows older than 24h are deleted on every write. Additive.
create table if not exists public.place_geocode_cache (
  key text primary key,
  lat double precision not null,
  lon double precision not null,
  label text not null,
  created_at timestamptz not null default now()
);
create index if not exists place_geocode_cache_created_idx on public.place_geocode_cache (created_at);
alter table public.place_geocode_cache enable row level security;
revoke all on public.place_geocode_cache from anon, authenticated, public;
grant select, insert, update, delete on public.place_geocode_cache to service_role;

-- Shared request budget for the public OpenStreetMap servers (Nominatim policy:
-- at most 1 request per second in total, across all users and instances).
-- Atomic claim: returns how many ms the caller must wait before sending, or -1
-- when the wait would exceed p_max_wait_ms (budget unavailable: do not send).
create table if not exists public.places_rate (
  host text primary key,
  next_at timestamptz not null default now()
);
alter table public.places_rate enable row level security;
revoke all on public.places_rate from anon, authenticated, public;

create or replace function public.claim_places_slot(p_host text, p_gap_ms integer, p_max_wait_ms integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_next timestamptz; v_slot timestamptz; v_wait integer;
begin
  if p_host is null or length(p_host) = 0 or length(p_host) > 200 then raise exception 'claim_places_slot: bad host'; end if;
  if p_gap_ms is null or p_gap_ms < 100 or p_gap_ms > 10000 then raise exception 'claim_places_slot: gap_ms must be 100..10000'; end if;
  if p_max_wait_ms is null or p_max_wait_ms < 0 or p_max_wait_ms > 5000 then raise exception 'claim_places_slot: max_wait_ms must be 0..5000'; end if;
  insert into public.places_rate (host, next_at) values (p_host, now()) on conflict (host) do nothing;
  select next_at into v_next from public.places_rate where host = p_host for update;
  v_slot := greatest(now(), v_next);
  v_wait := ceil(extract(epoch from (v_slot - now())) * 1000)::integer;
  if v_wait > p_max_wait_ms then return -1; end if;
  update public.places_rate set next_at = v_slot + make_interval(secs => p_gap_ms / 1000.0) where host = p_host;
  return v_wait;
end;
$$;
revoke all on function public.claim_places_slot(text, integer, integer) from anon, authenticated, public;
grant execute on function public.claim_places_slot(text, integer, integer) to service_role;
