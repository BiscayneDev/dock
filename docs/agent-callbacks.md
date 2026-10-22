# Agent callbacks

Agents (OpenClaw and anything else that runs outside Dock) report back to Dock with plain HTTP POSTs. These writes are authenticated with a shared secret.

## Endpoints that require the token

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/tasks/agent-spawn` | POST | Create an in-progress task |
| `/api/tasks/agent-done` | POST | Move a task to in-review |
| `/api/notify` | POST | Post a notification |

The browser routes `GET /api/notify/stream` and `GET /api/notify/recent` are not agent routes. They stay behind the normal sign-in session and do not take the token.

## Configuration

- Env var: `DOCK_AGENT_TOKEN`
- Dock side: set in `.env.local` for local dev and in the Vercel project env (production) for the deployed app.
- Agent side: the same value must be in the agent's environment as `DOCK_AGENT_TOKEN`.
- If `DOCK_AGENT_TOKEN` is unset or empty on Dock, every agent callback returns `401`. This fails closed on purpose.

## Sending the token

Either header works. Use one of:

- `Authorization: Bearer $DOCK_AGENT_TOKEN`
- `x-dock-agent-token: $DOCK_AGENT_TOKEN`

Never put the literal token value in prompts, logs, or task text. Read it from the environment.

## Example

```bash
curl -s -X POST "$DOCK_URL/api/notify" \
  -H "Content-Type: application/json" \
  -H "x-dock-agent-token: $DOCK_AGENT_TOKEN" \
  -d '{"agent":"builder","message":"✅ Done: Fix login","type":"finish"}'
```

```bash
curl -s -X POST "$DOCK_URL/api/tasks/agent-done" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DOCK_AGENT_TOKEN" \
  -d '{"id":"task-123","summary":"Shipped in commit abc123"}'
```

## Responses

- `401 {"error":"Unauthorized"}`: token missing, wrong, or `DOCK_AGENT_TOKEN` not set on Dock.
- Any other status: the request reached the route; check its body rules.
