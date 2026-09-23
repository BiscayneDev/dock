-- Resume claim as an RPC, mirroring claim_spectrum_outbox (migration 015).
-- The PostgREST schema cache has proven unreliable at picking up migration
-- 015's new columns (42703 on delivery_claimed_at for the update+returning
-- shape long after reload notifications); an RPC body is parsed by Postgres
-- at call time and does not depend on PostgREST column metadata at all.

create or replace function public.claim_pending_resume(p_chat_id text, p_lease_ms int)
returns table (id uuid, pending_request text)
language sql
security definer
as $$
    update public.connect_tokens
    set delivery_claimed_at = now()
    where connect_tokens.id = (
        select ct.id
        from public.connect_tokens ct
        where ct.platform = 'imessage'
          and ct.chat_id = p_chat_id
          and ct.completed_at is not null
          and ct.resumed_at is null
          and ct.terminal_at is null
          and ct.pending_request is not null
          and (
              ct.delivery_claimed_at is null
              or ct.delivery_claimed_at < now() - make_interval(secs => p_lease_ms / 1000.0)
          )
        order by ct.completed_at desc
        limit 1
        for update skip locked
    )
    returning connect_tokens.id, connect_tokens.pending_request;
$$;
