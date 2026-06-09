import type { Tool } from '@/lib/llm/types'
import { reminderSet, reminderList, reminderCancel } from './reminders'
import {
  gmailSearch,
  gmailRead,
  gmailSummarizeInbox,
  gmailDraft,
  gmailSend,
  gmailReply,
  gmailLabel,
  gmailArchive,
} from './gmail'
import {
  gcalListCalendars,
  gcalListEvents,
  gcalGetEvent,
  gcalCreateEvent,
  gcalUpdateEvent,
  gcalDeleteEvent,
  gcalFindFreeTime,
  gcalTodayBriefing,
} from './gcal'
import {
  notionSearch,
  notionReadPage,
  notionCreatePage,
  notionUpdatePage,
  notionQueryDatabase,
  notionCreateDatabaseItem,
} from './notion'
import {
  githubListRepos,
  githubGetRepo,
  githubListIssues,
  githubGetIssue,
  githubCreateIssue,
  githubListPrs,
  githubGetPr,
  githubListNotifications,
} from './github'
import {
  walletList,
  walletAccounts,
  walletBalance,
  walletSend,
  walletSignMessage,
  walletSimulate,
  walletInfo,
} from './wallet'
import { webSearch, webFetch } from './web'
import { x402Fetch, x402Search } from '@/lib/x402/client'
import {
  healthSleep,
  healthReadiness,
  healthActivity,
  healthHeartRate,
  healthSummary,
} from './health'
import {
  twitterTimeline,
  twitterSearch,
  twitterUserTweets,
  twitterBookmarks,
} from './twitter'
import { tokenPrice, trendingTokens, predictionMarkets } from './crypto'
import {
  payboxListCredentials,
  payboxRequestPayment,
  payboxRequestSecret,
  payboxGetRequest,
} from './paybox'
import { switchLLMProvider } from './llm-control'

// Recipe tools are imported lazily by the orchestrator since they're
// not available to the execution agent. See lib/tools/recipes.ts.

export const integrationTools: Tool[] = [
  // Gmail
  gmailSearch,
  gmailRead,
  gmailSummarizeInbox,
  gmailDraft,
  gmailSend,
  gmailReply,
  gmailLabel,
  gmailArchive,
  // Google Calendar
  gcalListCalendars,
  gcalListEvents,
  gcalGetEvent,
  gcalCreateEvent,
  gcalUpdateEvent,
  gcalDeleteEvent,
  gcalFindFreeTime,
  gcalTodayBriefing,
  // Notion
  notionSearch,
  notionReadPage,
  notionCreatePage,
  notionUpdatePage,
  notionQueryDatabase,
  notionCreateDatabaseItem,
  // GitHub
  githubListRepos,
  githubGetRepo,
  githubListIssues,
  githubGetIssue,
  githubCreateIssue,
  githubListPrs,
  githubGetPr,
  githubListNotifications,
  // Reminders
  reminderSet,
  reminderList,
  reminderCancel,
  // OpenWallet (crypto)
  walletList,
  walletAccounts,
  walletBalance,
  walletSend,
  walletSignMessage,
  walletSimulate,
  walletInfo,
  // Web (always available, no OAuth)
  webSearch,
  webFetch,
  // x402 protocol (paid API access)
  x402Fetch,
  x402Search,
  // Health (Oura, WHOOP)
  healthSleep,
  healthReadiness,
  healthActivity,
  healthHeartRate,
  healthSummary,
  // Twitter/X (read-only)
  twitterTimeline,
  twitterSearch,
  twitterUserTweets,
  twitterBookmarks,
  // Crypto (always available, no auth — CoinGecko + Polymarket)
  tokenPrice,
  trendingTokens,
  predictionMarkets,
  // Paybox (passkey-gated payments + secrets)
  payboxListCredentials,
  payboxRequestPayment,
  payboxRequestSecret,
  payboxGetRequest,
  // LLM runtime control (self-aware provider swap)
  switchLLMProvider,
]

// All tools except recipe management — used by the Execution Agent
export const executionAgentTools: Tool[] = [...integrationTools]

// Full tool set including recipe tools — used by the Orchestrator
// Populated in orchestrator/index.ts after importing recipe tools
export function getOrchestratorTools(recipeTools: Tool[]): Tool[] {
  return [...integrationTools, ...recipeTools]
}
