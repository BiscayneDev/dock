-- Inbound dedupe without failing open.
--
-- Before: a transient DB error during the dedupe insert processed the
-- message anyway, so Spectrum redeliveries during a blip produced duplicate
-- replies. Now the handler retries the claim, and each claim carries a
-- per-attempt claim_id: if an insert landed but its response was lost, the
-- retry sees its own claim_id and still processes (exactly once), while a
-- real redelivery sees someone else's and skips.

alter table public.spectrum_inbound_dedupe add column if not exists claim_id uuid;

create or replace function public.claim_inbound_delivery(
  p_message_id text, p_chat_guid text, p_claim_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.spectrum_inbound_dedupe (message_id, chat_guid, claim_id)
  values (p_message_id, p_chat_guid, p_claim_id)
  on conflict (message_id) do nothing;
  return exists (
    select 1 from public.spectrum_inbound_dedupe
    where message_id = p_message_id and claim_id = p_claim_id
  );
end;
$$;

revoke execute on function public.claim_inbound_delivery(text, text, uuid) from anon, authenticated, public;
grant execute on function public.claim_inbound_delivery(text, text, uuid) to service_role;

notify pgrst, 'reload schema';
