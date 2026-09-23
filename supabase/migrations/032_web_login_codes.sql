-- 032: Dinghy web sign-in (getdinghy.sh/login).
-- Phone number -> 6-digit code texted into the user's existing Dinghy
-- iMessage thread -> signed session. Codes are sha256-hashed, expire in
-- 10 minutes, are single-use, lock after 5 wrong tries, and a phone can
-- request at most 5 codes an hour. Server-only: RLS on, no policies; the
-- app reaches it through security-definer RPCs granted to service_role
-- (PostgREST schema cache is not trusted with new tables, see 017).

create table if not exists public.web_login_codes (
    id uuid primary key default gen_random_uuid(),
    phone text not null,
    chat_guid text not null,
    code_hash text not null,
    attempts int not null default 0,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists web_login_codes_phone_idx on public.web_login_codes (phone, created_at desc);
alter table public.web_login_codes enable row level security;

create or replace function public.dinghy_login_code_create(
    p_phone text, p_chat_guid text, p_code_hash text, p_ttl_seconds int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
    select count(*) into recent from web_login_codes
     where phone = p_phone and created_at > now() - interval '1 hour';
    if recent >= 5 then return false; end if;
    -- A new code retires any earlier unused one for this phone.
    update web_login_codes set used_at = now()
     where phone = p_phone and used_at is null;
    insert into web_login_codes (phone, chat_guid, code_hash, expires_at)
    values (p_phone, p_chat_guid, p_code_hash, now() + make_interval(secs => p_ttl_seconds));
    return true;
end $$;

create or replace function public.dinghy_login_code_verify(p_phone text, p_code_hash text)
returns text
language plpgsql security definer set search_path = public as $$
declare r web_login_codes%rowtype;
begin
    select * into r from web_login_codes
     where phone = p_phone and used_at is null and expires_at > now()
     order by created_at desc limit 1
     for update;
    if not found or r.attempts >= 5 then return null; end if;
    if r.code_hash = p_code_hash then
        update web_login_codes set used_at = now() where id = r.id;
        return r.chat_guid;
    end if;
    update web_login_codes set attempts = attempts + 1 where id = r.id;
    return null;
end $$;

revoke all on function public.dinghy_login_code_create(text, text, text, int) from public, anon, authenticated;
revoke all on function public.dinghy_login_code_verify(text, text) from public, anon, authenticated;
grant execute on function public.dinghy_login_code_create(text, text, text, int) to service_role;
grant execute on function public.dinghy_login_code_verify(text, text) to service_role;
notify pgrst, 'reload schema';
