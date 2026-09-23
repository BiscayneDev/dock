-- Outbox rows can carry a file: text holds the JSON document
-- ({title, subtitle?, body, format}); the sweep renders it with the brand
-- renderer and sends it as a native attachment. Used for server-initiated
-- files and retries.
alter table public.spectrum_outbox drop constraint if exists spectrum_outbox_kind_check;
alter table public.spectrum_outbox
  add constraint spectrum_outbox_kind_check check (kind in ('reply', 'connect_link', 'error_notice', 'file'));
