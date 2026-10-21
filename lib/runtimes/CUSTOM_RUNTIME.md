# Adding a Custom Runtime

Dock uses a pluggable runtime system. To add your own:

## 1. Create a runtime file

Create a new file in `lib/runtimes/`, e.g. `langchain.ts`:

```typescript
import type { AgentRuntime, RuntimeSession, ActivateParams, ChatParams } from "./types"

export class LangChainRuntime implements AgentRuntime {
  readonly name = "LangChain"
  readonly id = "langchain"

  async healthCheck() {
    // Check if your runtime is reachable
    return { ok: true, version: "1.0" }
  }

  async listSessions(): Promise<RuntimeSession[]> {
    // Return active sessions/agents
    return []
  }

  async chat({ message }: ChatParams): Promise<string> {
    // Send a message and return the reply
    return `Echo: ${message}`
  }

  async activate(params: ActivateParams): Promise<void> {
    // Fire-and-forget: start an agent on a task
  }

  async testDelivery(channel: string, target: string, message: string): Promise<void> {
    // Test sending a message to a delivery channel
  }
}
```

## 2. Register it

In `lib/runtimes/index.ts`, add:

```typescript
import { LangChainRuntime } from "./langchain"

registerRuntime("langchain", () => new LangChainRuntime())
```

## 3. Activate it

Set in your `.env.local`:

```
AGENT_RUNTIME=langchain
```

Restart the dev server and your runtime is live.
