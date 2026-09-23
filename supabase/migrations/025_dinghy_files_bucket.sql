-- Private bucket for files Dinghy makes (create_file). Service role only;
-- users get time-limited signed links as a fallback to the native attachment.
insert into storage.buckets (id, name, public, file_size_limit)
values ('dinghy-files', 'dinghy-files', false, 26214400)
on conflict (id) do nothing;
