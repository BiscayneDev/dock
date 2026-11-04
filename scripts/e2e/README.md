# Local connected-path harness (no cloud Supabase)

Runs the REAL Dock API routes + REAL mobile web build against a
protocol-compatible local stand-in for Supabase (GoTrue getUser + the
PostgREST subset Dock uses + the exchange_mobile_pairing RPC contract).
All other data (tasks, messages, repos, pairing) is the app's real file/SQL
code. Only the Supabase wire service is substituted; fictional seed data only.

1. `node scripts/e2e/mock-supabase.mjs` (listens on 127.0.0.1:4599)
2. `.env.local`: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4599,
   NEXT_PUBLIC_SUPABASE_ANON_KEY=demo, SUPABASE_SERVICE_ROLE_KEY=demo,
   DOCK_OWNER_EMAIL=demo@example.com, AGENT_RUNTIME=demo
3. Add `DOCK_DATA_DIR=scripts/e2e/fixtures` (absolute path) so tasks/messages
   come from the fictional fixture, never the repo's own data dir.
4. `npm run build && npx next start -p 3100`
5. `cd mobile && npx expo export --platform web` and serve `mobile/dist`
6. `node scripts/e2e/drive-mobile-web.mjs <6-digit code from POST /api/mobile/pair/create>`
