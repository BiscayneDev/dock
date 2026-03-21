import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

// Service role client — bypasses RLS.
// Uses untyped client to avoid strict generic conflicts on upsert/update
// across integrations. All table/column names are still validated at runtime by Supabase.
export function createServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }

  return createSupabaseClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
