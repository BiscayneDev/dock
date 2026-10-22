-- Approval previews: screenshots of the proposed work, shown on the approval card.
-- Private bucket. Writes happen only with the service role (bypasses RLS). Owners may read their own objects
-- directly; the card normally uses a 24h signed URL from /api/approvals/<runId>/preview instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('approval-previews', 'approval-previews', false, 5242880, array['image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "approval previews owner read" on storage.objects;
create policy "approval previews owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'approval-previews' and (storage.foldername(name))[1] = (select auth.uid())::text);
