// Shapes returned by the /api/knowledge contract. Every field is treated as
// tolerant/optional so an empty store (or a slightly different create vs patch
// payload) never breaks rendering.

export type KnowledgeType = "skill" | "domain" | "data_access"
export type DocStatusFilter = "active" | "stale" | "superseded"
export type TypeFilter = "all" | KnowledgeType
export type StatusFilter = "all" | DocStatusFilter

export interface KnowledgeDocument {
  id: string
  docId?: string | null
  type?: string | null
  title?: string | null
  description?: string | null
  status?: string | null
  trustTier?: string | null
  freshness?: string | null
  tags?: string[] | null
  sources?: string[] | null
  staleAfter?: string | null
  supersededBy?: string | null
  contentHash?: string | null
  body?: string | null
  updatedAt?: string | null
}

export interface DocsResponse {
  documents?: KnowledgeDocument[]
}

export interface KnowledgeFlag {
  id: string
  kind?: string | null
  ref?: string | null
  suggestedFix?: string | null
  evidence?: string | null
  runId?: string | null
  flagHash?: string | null
  createdAt?: string | null
}

export interface FlagCounts {
  missing: number
  wrong: number
  stale: number
}

export interface FlagsResponse {
  flags?: KnowledgeFlag[]
  counts?: Partial<FlagCounts>
}

export interface CuratorProposal {
  id: string
  status?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  decisionBy?: string | null
  decisionAt?: string | null
  decisionReason?: string | null
  appliedDocId?: string | null
  kind?: string | null
  docId?: string | null
  docPath?: string | null
  rationale?: string | null
  priority?: string | null
  evidenceRefs?: string[] | null
  flagIds?: string[] | null
  before?: unknown
  after?: unknown
  document?: KnowledgeDocument | null
  section?: string | null
  changedFields?: string[] | null
  demotion?: unknown
  conflicts?: unknown
}

export interface ProposalsResponse {
  proposals?: CuratorProposal[]
}

export interface CurateResponse {
  created?: number | unknown[]
  conflicts?: number | unknown[]
  ignored?: number | unknown[]
}

export interface ExportFile {
  path: string
  content: string
}

export interface ExportBundle {
  index?: unknown
  files?: ExportFile[]
}

export interface ExportResponse {
  bundle?: ExportBundle
}

export interface DecisionResponse {
  proposal?: CuratorProposal
  error?: string
}
