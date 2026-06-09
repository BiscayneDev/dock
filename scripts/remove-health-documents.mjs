// One-off cleanup: remove the legacy `health_documents` storage bucket.
// It's leftover from an old project (no Dock code references it; its objects
// were a one-day 2025-04-26 batch, none owned by current Dock users).
//
// Supabase blocks direct SQL deletion of storage rows (protect_delete trigger),
// so removal must go through the Storage API with the service-role key. The
// orphaned RLS policies were already dropped in migration 009; this empties and
// deletes the bucket itself. Run from the dock repo root:
//
//   NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
//     node scripts/remove-health-documents.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'health_documents'

if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const { error: emptyErr } = await supabase.storage.emptyBucket(BUCKET)
if (emptyErr) {
  console.error(`emptyBucket(${BUCKET}) failed:`, emptyErr.message)
  process.exit(1)
}
console.log(`Emptied bucket "${BUCKET}".`)

const { error: delErr } = await supabase.storage.deleteBucket(BUCKET)
if (delErr) {
  console.error(`deleteBucket(${BUCKET}) failed:`, delErr.message)
  process.exit(1)
}
console.log(`Deleted bucket "${BUCKET}". Done.`)
