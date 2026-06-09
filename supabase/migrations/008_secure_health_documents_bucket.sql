-- Secure the health_documents storage bucket (PHI).
-- Before: bucket was public, and the storage.objects policies were scoped only
-- by bucket_id — so any authenticated user could read/update/delete ANY user's
-- health documents, and objects were fetchable via unsigned public URLs.
-- After: bucket is private (access via signed URLs / authenticated policy), and
-- each policy is owner-scoped (auth.uid() = owner). All 13 existing objects have
-- a non-null owner, so per-user access is preserved; only cross-tenant access is
-- removed. Mirrors the already-correct policies on the health-documents bucket.

update storage.buckets set public = false where id = 'health_documents';

alter policy "Allow authenticated users to read their own documents"
  on storage.objects
  using (bucket_id = 'health_documents' and auth.uid() = owner);

alter policy "Allow authenticated users to update their own documents"
  on storage.objects
  using (bucket_id = 'health_documents' and auth.uid() = owner)
  with check (bucket_id = 'health_documents' and auth.uid() = owner);

alter policy "Allow authenticated users to delete their own documents"
  on storage.objects
  using (bucket_id = 'health_documents' and auth.uid() = owner);

alter policy "Allow authenticated users to upload their own documents"
  on storage.objects
  with check (bucket_id = 'health_documents' and auth.uid() = owner);
