-- Waitlist: capture name + X/Twitter handle so the owner can look signups up.
-- Both nullable: existing rows have neither, and the handle is optional on the form.
-- twitter_handle is stored without the leading @ and validated to X's format.

alter table public.waitlist
  add column if not exists name text,
  add column if not exists twitter_handle text;

alter table public.waitlist
  drop constraint if exists waitlist_name_len,
  add constraint waitlist_name_len check (name is null or char_length(name) between 1 and 80);

alter table public.waitlist
  drop constraint if exists waitlist_twitter_handle_format,
  add constraint waitlist_twitter_handle_format check (twitter_handle is null or twitter_handle ~ '^[A-Za-z0-9_]{1,15}$');
