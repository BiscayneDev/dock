# Isolated task runs

Every coding task can run in its own git worktree on its own branch, so sibling
agents never share a checkout. Integration happens at a reviewed merge, never in a
shared directory.

## Flow

1. Activate with isolation: `POST /api/tasks/activate` with `repoPath` (and optional
   `baseRef`, default `HEAD`). Unlike plain activation this requires an owner
   session or the agent token, because it runs git on local paths.
2. Dock creates `.dock-worktrees/<repo>/<taskId>` next to the repo (never inside the
   main checkout) on branch `dock/task-<taskId>`, and records a `worktree.created`
   event on the task's conversation.
3. The delegated brief instructs the agent to work only inside that worktree on that
   branch: no sibling directories, no branch switching, no push, no merge.
4. Review: `GET /api/tasks/<id>/worktree` returns the worktree plus the diff of the
   task branch against base (`git diff --stat`, name-status, commit list). The task's
   edit dialog shows the same card and refreshes it.
5. Merge is a human decision. Agents never push or merge. Cleanup is
   `removeTaskWorktree`, which only ever deletes `dock/task-*` branches.

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
- `app/api/tasks/activate/route.ts` - `repoPath`/`baseRef` options
- `app/api/tasks/[id]/worktree/route.ts` - review surface
- `components/tasks/WorktreeReviewCard.tsx` - owner review card
- `test/isolation-worktree.test.mjs` - naming, containment, env scrubbing, and real
  git behavior (create, sibling-refusal, isolated commit, diff, cleanup)

Run the tests: `node --experimental-strip-types --test test/isolation-worktree.test.mjs`
