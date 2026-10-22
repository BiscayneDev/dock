// Plan-graph parsing and topological ordering. Pure, no imports (tests load directly).

export interface PlanNode {
  id: string
  title: string
  dependsOn: string[]
  agentKey?: string
  estimateCents?: number
}

/** Appended to the system prompt for plan-mode runs so outputs end with a parseable graph. */
export const PLAN_GRAPH_INSTRUCTION = [
  "END YOUR PLAN WITH A MACHINE-READABLE GRAPH.",
  "Finish your output with a fenced block tagged 'plan' containing JSON:",
  "\u0060\u0060\u0060plan",
  '{"nodes": [{"id": "n1", "title": "Short step", "dependsOn": [], "agentKey": "engineer", "estimateCents": 500}]}',
  "\u0060\u0060\u0060",
  "Every node needs a unique id, a short title, and dependsOn listing ids of nodes that must finish first. Omit agentKey or estimateCents if unknown.",
].join("\n")

function extractPlanBlock(text: string): string | null {
  const fence = text.match(/^\s*```plan[^\n]*\n([\s\S]*?)```\s*$/m)
    ?? text.match(/\n\s*```plan[^\n]*\n([\s\S]*?)```\s*$/)
  return fence ? fence[1] : null
}

function validateNode(raw: unknown, knownIds: Set<string>, index: number): PlanNode {
  const prefix = `plan node #${index}`
  if (typeof raw !== "object" || raw === null) throw new Error(`${prefix}: not an object`)
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || !o.id.trim()) throw new Error(`${prefix}: "id" must be a non-empty string`)
  if (typeof o.title !== "string" || !o.title.trim()) throw new Error(`${prefix} (${o.id}): "title" must be a non-empty string`)
  if (!Array.isArray(o.dependsOn) || o.dependsOn.some((d) => typeof d !== "string")) {
    throw new Error(`${prefix} (${o.id}): "dependsOn" must be an array of strings`)
  }
  for (const dep of o.dependsOn) {
    if (!knownIds.has(dep)) throw new Error(`${prefix} (${o.id}): unknown dependsOn reference "${dep}"`)
  }
  const node: PlanNode = { id: o.id, title: o.title, dependsOn: o.dependsOn }
  if (typeof o.agentKey === "string" && o.agentKey.trim()) node.agentKey = o.agentKey
  if (typeof o.estimateCents === "number" && Number.isFinite(o.estimateCents)) node.estimateCents = o.estimateCents
  return node
}

/**
 * Parse the trailing ```plan fenced block from a plan-mode output. Only the block is
 * read; any prose before it is ignored. Throws with a clear message when the block is
 * missing or malformed.
 */
export function parsePlanGraph(text: string): PlanNode[] {
  if (typeof text !== "string" || !text.trim()) throw new Error("plan output is empty; no plan block found")
  const block = extractPlanBlock(text)
  if (block === null) {
    throw new Error('no ```plan fenced block found at the end of the output')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(block)
  } catch {
    throw new Error("plan block is not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("plan block JSON must be an object with a \"nodes\" array")
  const nodesRaw = (parsed as Record<string, unknown>).nodes
  if (!Array.isArray(nodesRaw)) throw new Error('plan block JSON must have a "nodes" array')
  const knownIds = new Set<string>()
  for (const raw of nodesRaw) {
    if (typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).id === "string") {
      knownIds.add((raw as Record<string, unknown>).id as string)
    }
  }
  const seen = new Set<string>()
  return nodesRaw.map((raw, i) => {
    const node = validateNode(raw, knownIds, i)
    if (seen.has(node.id)) throw new Error(`duplicate node id "${node.id}"`)
    seen.add(node.id)
    return node
  })
}

/**
 * Kahn's algorithm topological order. Throws on a cycle (or self-dependency).
 */
export function topoOrder(nodes: PlanNode[]): PlanNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const indegree = new Map(nodes.map((n) => [n.id, 0]))
  const dependents = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!byId.has(dep)) throw new Error(`node "${node.id}" depends on unknown node "${dep}"`)
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1)
      dependents.get(dep)!.push(node.id)
    }
  }
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const order: PlanNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(byId.get(id)!)
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  if (order.length !== nodes.length) {
    const stuck = nodes.filter((n) => (indegree.get(n.id) ?? 0) > 0).map((n) => n.id)
    throw new Error(`plan graph has a dependency cycle involving: ${stuck.join(", ")}`)
  }
  return order
}
