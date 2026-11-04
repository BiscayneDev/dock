# Local shared knowledge foundation

Install the official `graphifyy` package in a dedicated environment. The tested
version is 0.9.102. The official CLI is `graphify`; similarly named packages are
not substitutes. Sources: https://github.com/Graphify-Labs/graphify and
https://docs.graphify.com/open-source/overview.

Run `node scripts/knowledge/build.mjs explicit-repos.json /private/output`.
The config names the executable and every repository explicitly:

```json
{"graphifyExecutable":"/path/to/venv/bin/graphify","repos":[{"key":"dock","path":"/path/to/dock","include":["lib","node/dock-node","README.md"]}]}
```

Only committed source/doc bytes at each repo's HEAD are used, never a task's
dirty files, credentials, private execution logs or sibling object database.
Graphify runs `--code-only --no-cluster` with a scrubbed environment. Markdown
headings are indexed separately by a deterministic local parser. This is
structural doc indexing, not semantic document understanding. There are no
model calls, private-document uploads or hosted Graphify accounts.

Outputs are a graph and a manifest with commit + content hashes. Keep them out
of the public repository. `DOCK_SHARED_KNOWLEDGE_DIR` makes the home runner add
a bounded source-linked bundle to its builder brief. The full graph and memory
store are not mounted into a task. Graph contents are data, never instructions.
Builder, reviewer and scout brief templates are local roles, not a claim that
an autonomous multi-agent scheduler is complete.

`shared-memory.mjs` separates task fact proposals from host-reviewed facts.
Nothing auto-promotes a model's output into shared truth. Review/promotion is
host-only and is not exposed as an agent tool. A persistent host review queue
and agent-specific memory UX remain to be integrated.

A local checkpoint indexed a scoped subset of Dock and Shipyard Inference:
30 committed source/doc files, 319 nodes and 501 edges, including 64 document
nodes. This is not every Shipyard repository. A broader 599-code-file trial
exceeded the interactive execution window; do not call that full scan done.
