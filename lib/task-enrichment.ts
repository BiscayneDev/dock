import { runtime } from "@/lib/runtime"
import type { Task } from "@/lib/tasks"

export interface TaskEnrichment {
  enrichedTitle: string
  enrichedDescription: string
  acceptanceCriteria: string[]
  implementationPlan: string[]
  risks: string[]
  toolNeeds: string[]
  recommendedAssignee?: Task["assignee"]
}

function fallbackEnrichment(task: Pick<Task, "title" | "description" | "priority" | "assignee" | "tags">): TaskEnrichment {
  const title = task.title.trim()
  const summary = task.description?.trim() || title
  // Heuristic tool needs: match paid-tool intent even without an LLM so the
  // Buoy quote card always has something to quote.
  const text = `${title} ${summary}`.toLowerCase()
  const toolNeeds: string[] = []
  if (/\b(research|competitor|news|latest|find|funding|search)\b/.test(text)) {
    toolNeeds.push("web search for current information on this topic")
  }
  if (/\b(scrape|pricing pages|crawl|extract from|website)\b/.test(text)) {
    toolNeeds.push("scrape web pages and extract structured content")
  }
  if (/\b(price|market|crypto|token|btc|eth|stock|vwap)\b/.test(text)) {
    toolNeeds.push("live market or token price data")
  }
  if (/\b(map|route|geocod|location|nearby|address)\b/.test(text)) {
    toolNeeds.push("geocode addresses or map a route")
  }
  // GTM: prospecting and company enrichment route to the enrichment services.
  if (/\b(prospect|outreach|leads|gtm|icp|account list|decision maker|target account|b2b|recruit|work email|contacts?)\b/.test(text)) {
    toolNeeds.push("find decision makers at target accounts with their work emails")
  }
  if (/\b(company profile|firmographics|enrich compan|company data|company overview|company research)\b/.test(text)) {
    toolNeeds.push("company profile and firmographics for a domain")
  }
  return {
    enrichedTitle: title,
    enrichedDescription: [
      `Objective: ${summary}`,
      `Priority: ${task.priority}`,
      `Current assignee: ${task.assignee}`,
    ].join("\n"),
    acceptanceCriteria: [
      "User can complete the flow without breaking existing sign-up behavior",
      "Implementation is covered by a test or manual verification path",
      "Task description reflects the final approach clearly enough for handoff",
    ],
    implementationPlan: [
      "Audit the current sign-up flow and identify insertion points",
      "Implement the smallest safe change behind existing task and approval flow",
      "Verify the behavior in the UI and update the task record with the final result",
    ],
    risks: ["Scope creep if the brief is left too open", "Authentication or onboarding regressions"],
    toolNeeds,
    recommendedAssignee: task.assignee,
  }
}

export async function enrichTaskBrief(task: Pick<Task, "title" | "description" | "priority" | "assignee" | "tags">): Promise<TaskEnrichment> {
  const prompt = [
    "You are improving a product task brief before execution.",
    "Return strict JSON with keys: enrichedTitle, enrichedDescription, acceptanceCriteria, implementationPlan, risks, recommendedAssignee.",
    "Make it concise, specific, and execution-ready.",
    `Title: ${task.title}`,
    `Description: ${task.description ?? ""}`,
    `Priority: ${task.priority}`,
    `Assignee: ${task.assignee}`,
    `Tags: ${(task.tags ?? []).join(", ")}`,
    "Also return a toolNeeds array: 0-5 short natural-language phrases naming the PAID external tools or data this task needs (e.g. \"web search for competitor funding data\", \"scrape the competitor landing pages\", \"geocode addresses\", \"find decision makers at target accounts with their work emails\" for GTM/prospecting tasks, \"company profile and firmographics for a domain\" for company enrichment). Empty array if the task needs none.",
  ].join("\n")

  try {
    const reply = await runtime.chat({ message: prompt })
    const parsed = JSON.parse(reply) as Partial<TaskEnrichment>
    if (parsed.enrichedTitle && parsed.enrichedDescription && Array.isArray(parsed.acceptanceCriteria) && Array.isArray(parsed.implementationPlan) && Array.isArray(parsed.risks)) {
      return {
        enrichedTitle: parsed.enrichedTitle,
        enrichedDescription: parsed.enrichedDescription,
        acceptanceCriteria: parsed.acceptanceCriteria.filter(Boolean).map(String),
        implementationPlan: parsed.implementationPlan.filter(Boolean).map(String),
        risks: parsed.risks.filter(Boolean).map(String),
        toolNeeds: Array.isArray(parsed.toolNeeds)
          ? parsed.toolNeeds.filter(Boolean).map(String).slice(0, 5)
          : [],
        recommendedAssignee: parsed.recommendedAssignee ?? task.assignee,
      }
    }
  } catch {
    // fall through
  }

  return fallbackEnrichment(task)
}
