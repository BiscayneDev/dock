import type { Tool } from '@/lib/llm/types'
import { webSearch, webFetch } from './web'
import {
  githubListRepos,
  githubGetRepo,
  githubListIssues,
  githubGetIssue,
  githubListPrs,
  githubGetPr,
} from './github'
import { tokenPrice, trendingTokens } from './crypto'

// Sandboxed tool subset for x402 recipe execution
// (src/app/api/x402/recipes/[id]/execute/route.ts).
//
// x402 executions run untrusted `userInput` from arbitrary paying agents
// inside the recipe creator's context, so this list is read-only and
// spend-free by construction. Allowed tools:
//   - webSearch, webFetch        — public web reads, no auth, no spend
//   - githubListRepos/GetRepo/   — GitHub reads (listNotifications excluded:
//     ListIssues/GetIssue/         it reads the creator's private inbox)
//     ListPrs/GetPr
//   - tokenPrice, trendingTokens — public market data, no auth
//
// Explicitly excluded: every write/send/delete tool (gmail_*, gcal_* create/
// update/delete, githubCreateIssue, reminders), every wallet/paybox tool
// (payments, swaps, signing, secrets, credentials — no spend and no access to
// the creator's tokens for money paths), memoryForget, x402_search and
// x402_fetch (the whole paid-API surface), predictionMarkets, recipe tools,
// switchLLMProvider, getInferenceSpend.
//
// The route must pass exactly this list to runAgentLoop — never
// executionAgentTools or any superset.
export const x402RecipeTools: Tool[] = [
  webSearch,
  webFetch,
  githubListRepos,
  githubGetRepo,
  githubListIssues,
  githubGetIssue,
  githubListPrs,
  githubGetPr,
  tokenPrice,
  trendingTokens,
]
