import { z } from 'zod'
import { getOctokitClient } from '@/lib/integrations/github'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

function getClient(ctx: UserContext): ReturnType<typeof getOctokitClient> {
  const tokens = ctx.tokens.github
  if (!tokens) {
    throw new Error('GitHub integration not connected')
  }
  return getOctokitClient(tokens)
}

// --- github_list_repos ---

const ListReposInput = z.object({
  sort: z.enum(['updated', 'pushed', 'full_name', 'created']).optional().default('updated'),
  perPage: z.number().optional().default(20),
})

export const githubListRepos: Tool = {
  name: 'github_list_repos',
  description: "List the user's GitHub repositories, sorted by most recently updated.",
  inputSchema: {
    type: 'object',
    properties: {
      sort: { type: 'string', enum: ['updated', 'pushed', 'full_name', 'created'], description: 'Sort order' },
      perPage: { type: 'number', description: 'Results per page (default 20)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ListReposInput.parse(input)
      const octokit = getClient(ctx)

      const res = await octokit.repos.listForAuthenticatedUser({
        sort: parsed.sort,
        per_page: parsed.perPage,
      })

      const repos = res.data.map((r) => ({
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        language: r.language,
        stars: r.stargazers_count,
        updatedAt: r.updated_at,
        openIssues: r.open_issues_count,
      }))

      return { success: true, data: { count: repos.length, repos } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- github_get_repo ---

const GetRepoInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
})

export const githubGetRepo: Tool = {
  name: 'github_get_repo',
  description: 'Get details of a specific GitHub repository.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repo owner' },
      repo: { type: 'string', description: 'Repo name' },
    },
    required: ['owner', 'repo'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = GetRepoInput.parse(input)
      const octokit = getClient(ctx)

      const res = await octokit.repos.get({ owner: parsed.owner, repo: parsed.repo })
      const r = res.data

      return {
        success: true,
        data: {
          fullName: r.full_name,
          description: r.description,
          private: r.private,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          openIssues: r.open_issues_count,
          defaultBranch: r.default_branch,
          updatedAt: r.updated_at,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- github_list_issues ---

const ListIssuesInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  labels: z.string().optional().describe('Comma-separated label names'),
  assignee: z.string().optional().describe('Filter by assignee username'),
  perPage: z.number().optional().default(20),
})

export const githubListIssues: Tool = {
  name: 'github_list_issues',
  description: 'List issues for a repository, filterable by state, labels, and assignee.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repo owner' },
      repo: { type: 'string', description: 'Repo name' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state filter' },
      labels: { type: 'string', description: 'Comma-separated label names' },
      assignee: { type: 'string', description: 'Filter by assignee' },
      perPage: { type: 'number', description: 'Results per page' },
    },
    required: ['owner', 'repo'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ListIssuesInput.parse(input)
      const octokit = getClient(ctx)

      const res = await octokit.issues.listForRepo({
        owner: parsed.owner,
        repo: parsed.repo,
        state: parsed.state,
        labels: parsed.labels,
        assignee: parsed.assignee,
        per_page: parsed.perPage,
      })

      // Filter out pull requests (GitHub API returns PRs as issues)
      const issues = res.data
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          author: i.user?.login,
          labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
          assignees: i.assignees?.map((a) => a.login) ?? [],
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        }))

      return { success: true, data: { count: issues.length, issues } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- github_get_issue ---

const GetIssueInput = z.object({
  owner: z.string(),
  repo: z.string(),
  issueNumber: z.number().describe('Issue number'),
})

export const githubGetIssue: Tool = {
  name: 'github_get_issue',
  description: 'Get full details of a specific GitHub issue including body and comments.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repo owner' },
      repo: { type: 'string', description: 'Repo name' },
      issueNumber: { type: 'number', description: 'Issue number' },
    },
    required: ['owner', 'repo', 'issueNumber'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = GetIssueInput.parse(input)
      const octokit = getClient(ctx)

      const [issue, comments] = await Promise.all([
        octokit.issues.get({ owner: parsed.owner, repo: parsed.repo, issue_number: parsed.issueNumber }),
        octokit.issues.listComments({
          owner: parsed.owner,
          repo: parsed.repo,
          issue_number: parsed.issueNumber,
          per_page: 10,
        }),
      ])

      return {
        success: true,
        data: {
          number: issue.data.number,
          title: issue.data.title,
          state: issue.data.state,
          body: issue.data.body?.slice(0, 3000) ?? '',
          author: issue.data.user?.login,
          labels: issue.data.labels.map((l) => (typeof l === 'string' ? l : l.name)),
          assignees: issue.data.assignees?.map((a) => a.login) ?? [],
          createdAt: issue.data.created_at,
          comments: comments.data.map((c) => ({
            author: c.user?.login,
            body: c.body?.slice(0, 1000) ?? '',
            createdAt: c.created_at,
          })),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- github_create_issue ---

const CreateIssueInput = z.object({
  owner: z.string(),
  repo: z.string(),
  title: z.string().describe('Issue title'),
  body: z.string().optional().describe('Issue body (markdown)'),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
})

export const githubCreateIssue: Tool = {
  name: 'github_create_issue',
  description: 'Create a new GitHub issue.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repo owner' },
      repo: { type: 'string', description: 'Repo name' },
      title: { type: 'string', description: 'Issue title' },
      body: { type: 'string', description: 'Issue body (markdown)' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Labels' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Assignees' },
    },
    required: ['owner', 'repo', 'title'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = CreateIssueInput.parse(input)
      const octokit = getClient(ctx)

      const res = await octokit.issues.create({
        owner: parsed.owner,
        repo: parsed.repo,
        title: parsed.title,
        body: parsed.body,
        labels: parsed.labels,
        assignees: parsed.assignees,
      })

      return {
        success: true,
        data: {
          number: res.data.number,
          title: res.data.title,
          url: res.data.html_url,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- github_list_prs ---

const ListPrsInput = z.object({
  owner: z.string(),
  repo: z.string(),
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  perPage: z.number().optional().default(20),
})

export const githubListPrs: Tool = {
  name: 'github_list_prs',
  description: 'List pull requests for a repository.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repo owner' },
      repo: { type: 'string', description: 'Repo name' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR state filter' },
      perPage: { type: 'number', description: 'Results per page' },
    },
    required: ['owner', 'repo'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ListPrsInput.parse(input)
      const octokit = getClient(ctx)

      const res = await octokit.pulls.list({
        owner: parsed.owner,
        repo: parsed.repo,
        state: parsed.state,
        per_page: parsed.perPage,
      })

      const prs = res.data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login,
        draft: pr.draft,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at,
        reviewers: pr.requested_reviewers?.map((r) => ('login' in r ? r.login : (r as Record<string, unknown>).name as string)) ?? [],
      }))

      return { success: true, data: { count: prs.length, prs } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- github_get_pr ---

const GetPrInput = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().describe('Pull request number'),
})

export const githubGetPr: Tool = {
  name: 'github_get_pr',
  description: 'Get pull request details including diff summary.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repo owner' },
      repo: { type: 'string', description: 'Repo name' },
      prNumber: { type: 'number', description: 'PR number' },
    },
    required: ['owner', 'repo', 'prNumber'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = GetPrInput.parse(input)
      const octokit = getClient(ctx)

      const [pr, files] = await Promise.all([
        octokit.pulls.get({ owner: parsed.owner, repo: parsed.repo, pull_number: parsed.prNumber }),
        octokit.pulls.listFiles({
          owner: parsed.owner,
          repo: parsed.repo,
          pull_number: parsed.prNumber,
          per_page: 30,
        }),
      ])

      return {
        success: true,
        data: {
          number: pr.data.number,
          title: pr.data.title,
          state: pr.data.state,
          body: pr.data.body?.slice(0, 2000) ?? '',
          author: pr.data.user?.login,
          draft: pr.data.draft,
          mergeable: pr.data.mergeable,
          additions: pr.data.additions,
          deletions: pr.data.deletions,
          changedFiles: pr.data.changed_files,
          files: files.data.map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
          })),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- github_list_notifications ---

const ListNotificationsInput = z.object({
  all: z.boolean().optional().default(false).describe('Include read notifications'),
  since: z.string().optional().describe('ISO 8601 timestamp to filter from'),
})

export const githubListNotifications: Tool = {
  name: 'github_list_notifications',
  description: 'List GitHub notifications (unread by default).',
  inputSchema: {
    type: 'object',
    properties: {
      all: { type: 'boolean', description: 'Include read notifications' },
      since: { type: 'string', description: 'Filter from timestamp (ISO 8601)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ListNotificationsInput.parse(input)
      const octokit = getClient(ctx)

      const res = await octokit.activity.listNotificationsForAuthenticatedUser({
        all: parsed.all,
        since: parsed.since,
        per_page: 20,
      })

      const notifications = res.data.map((n) => ({
        id: n.id,
        repo: n.repository.full_name,
        type: n.subject.type,
        title: n.subject.title,
        reason: n.reason,
        unread: n.unread,
        updatedAt: n.updated_at,
        url: n.subject.url,
      }))

      return { success: true, data: { count: notifications.length, notifications } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}
