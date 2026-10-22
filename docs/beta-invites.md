# Beta invites (closed beta, invite-only)

Sign-in is Supabase email codes. Access is limited to:

1. **The owner** (`DOCK_OWNER_EMAIL`): full access, admin override.
2. **Beta members**: emails on `public.beta_allowlist` with `revoked_at` null. They can use `/onboarding`, `/assistant` and the workspace APIs only. Conversations, tasks, memory, and chat stay owner-only until they move off files.

Everyone else is signed out and sent to `/login`.

## Invite someone

Run from the repo, with the service role read from `.env.local` (never sent to a browser):

```bash
export PATH=/opt/homebrew/Cellar/node/25.4.0/bin:$PATH
node --env-file=.env.local scripts/beta-access.mjs invite person@example.com
```

It prints a one-time link `https://dock-harness.vercel.app/login?invite=<token>`, valid 7 days (`--days N`). Send it to that person. They open it, enter the same email, and enter the code from Supabase's email. The app redeems the invite, adds the email to the allowlist, and sends them to onboarding.

Tokens are never stored, only their SHA-256. An invite works once, and only for the email it was made for.

## Other commands

```bash
node --env-file=.env.local scripts/beta-access.mjs grant person@example.com   # allowlist without an invite
node --env-file=.env.local scripts/beta-access.mjs revoke person@example.com  # removes access on their next request
node --env-file=.env.local scripts/beta-access.mjs list
```

Revoking ends access on the next request, because the proxy checks the allowlist every time.

## Notes

- New accounts are created only when an invite token is present (`shouldCreateUser`).
- The invite redeem route is reachable by signed-in users who are not yet allowed, and by no one else.
- Supabase's built-in email sends the codes. SMTP is not configured.
