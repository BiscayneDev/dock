-- Remove the orphaned health-document storage policies — leftover from an old
-- project (no Dock code references the bucket; its 13 objects were a one-day
-- 2025-04-26 batch, none owned by current Dock users).
--
-- The objects and the bucket themselves can't be dropped here: Supabase blocks
-- direct DELETE on storage tables (use the Storage API). See
-- scripts/remove-health-documents.mjs to empty + delete the bucket with the
-- service-role key. Dropping the policies is safe — the cleanup script uses the
-- service role, which bypasses RLS.
drop policy if exists "Allow authenticated users to read their own documents" on storage.objects;
drop policy if exists "Allow authenticated users to update their own documents" on storage.objects;
drop policy if exists "Allow authenticated users to delete their own documents" on storage.objects;
drop policy if exists "Allow authenticated users to upload their own documents" on storage.objects;
drop policy if exists "Users can read their own documents" on storage.objects;
drop policy if exists "Users can upload their own documents" on storage.objects;
