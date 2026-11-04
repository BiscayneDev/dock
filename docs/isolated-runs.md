# Isolated task runs

Every coding task can run in its own git worktree on its own branch, so sibling
agents never share a checkout. Integration happens at a reviewed merge, never in a
shared directory.

## Flow

1. Register the repo once: `POST /api/repos` with `{"path": "/abs/path/to/repo"}`,
   owner session only. The allowlist lives in
   `~/.config/dock/private/registered-repos.json` (private-store guarantees:
   outside the app tree, 0700/0600, no symlinks). The agent token can use a
   registered repo but cannot register one, so a token cannot point Dock at an
   arbitrary host path.
2. Activate with isolation: `POST /api/tasks/activate` with `repoPath` (and optional
   `baseRef`, default `HEAD`). Unlike plain activation this requires an owner
   session or the agent token, because it runs git on local paths. The path must
   resolve (realpath, so symlinks are compared by real destination) to a
   registered repo, and `baseRef` is strictly validated (`isValidBaseRef`)
   before it reaches a git command line - no `..`, no leading `-`, no ref
   metacharacters, so option injection into `git worktree add` is refused.
3. Dock creates `.dock-worktrees/<repo>/<taskId>` next to the repo (never inside the
   main checkout) on branch `dock/task-<taskId>`, and records a `worktree.created`
   event on the task's conversation.
4. The delegated brief instructs the agent to work only inside that worktree on that
   branch: no sibling directories, no branch switching, no push, no merge.
5. Review: `GET /api/tasks/<id>/worktree` returns the worktree plus the diff of the
   task branch against base (`git diff --stat`, name-status, commit list). The task's
   edit dialog shows the same card and refreshes it.
6. Merge is a human decision. Agents never push or merge. Cleanup is
   `removeTaskWorktree`, which only ever deletes `dock/task-*` branches.

The review surface reads with the owner session or the scoped mobile token
(`DOCK_MOBILE_TOKEN`, capability `worktree:read`) - deliberately not the
superuser agent token. The mobile token's whole surface is the capability list
in `lib/mobile-auth.ts` (task read/activate, repo read, worktree read, messages,
runs read, approval decisions, push registration); it cannot register repos,
post notifications, or call agent callbacks.

`GET /api/tasks/<id>/worktree` also runs `verifyTaskWorktree`: the worktree must
still exist, stay inside its root after symlinks resolve, be registered with
`git worktree list`, and be checked out on the task branch. Drift (e.g. an agent
that switched branches inside its worktree) is reported in `verification.problems`.
This is detection, not confinement.

`ActivateParams.worktree` carries the worktree as a structured field, so a runtime
that controls the agent process working directory must confine it there. Dock's
current OpenClaw runtime delivers to an external gateway: that agent process runs
outside Dock's control, and confining its filesystem access is an infrastructure
property of the gateway host (per-task container or OS user), not something the
Next.js app can enforce. That boundary is the honest enforcement line today:
Dock enforces registered repos, validated refs, contained paths, scrubbed
environments and attestation; process confinement of an externally-run agent
needs the container layer below.

## Discipline vs enforcement

A worktree separates working files, branch and index. Per git's own docs, worktrees
share the repository's object store, refs, config and hooks, and an agent process
runs with the OS user's permissions: nothing in git stops it from reading a sibling
worktree, mutating shared refs, or touching services and secrets outside the repo.
This is the discipline layer. A hard no-crossover boundary additionally needs
process-level isolation (a separate container or OS user per agent), scoped
credentials, and deny rules on shared services. Child processes spawned by the
worktree helper receive an allowlisted environment (`scrubEnv`) so they do not
inherit API keys by accident.

## Files

- `lib/isolation/worktree.ts` - worktree manager (pure helpers + git I/O)
- `lib/isolation/registered-repos.ts` - owner-managed repo allowlist
- `app/api/repos/route.ts` - registration endpoint (owner session only)
- `app/api/tasks/activate/route.ts` - `repoPath`/`baseRef` options
- `app/api/tasks/[id]/worktree/route.ts` - review surface
- `components/tasks/WorktreeReviewCard.tsx` - owner review card
- `test/isolation-worktree.test.mjs` - naming, containment, env scrubbing, and real
  git behavior (create, sibling-refusal, isolated commit, diff, cleanup)
- `test/isolation-security.test.mjs` - base-ref validation, allowlist behavior
  (incl. symlink resolution to a registered repo), and drift attestation

Run the tests: `node --experimental-strip-types --test test/isolation-worktree.test.mjs`
