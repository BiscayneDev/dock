import { z } from 'zod'
import { getNotionClient } from '@/lib/integrations/notion'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

function getClient(ctx: UserContext): ReturnType<typeof getNotionClient> {
  const tokens = ctx.tokens.notion
  if (!tokens) {
    throw new Error('Notion integration not connected')
  }
  return getNotionClient(tokens)
}

// --- notion_search ---

const SearchInput = z.object({
  query: z.string().describe('Search query text'),
  filter: z.enum(['page', 'data_source']).optional().describe('Filter by object type'),
})

export const notionSearch: Tool = {
  name: 'notion_search',
  description: 'Search Notion pages and databases by query text.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      filter: { type: 'string', enum: ['page', 'data_source'], description: 'Filter by type' },
    },
    required: ['query'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SearchInput.parse(input)
      const notion = getClient(ctx)

      const params: Parameters<typeof notion.search>[0] = {
        query: parsed.query,
        page_size: 10,
      }
      if (parsed.filter) {
        params.filter = { value: parsed.filter, property: 'object' }
      }

      const res = await notion.search(params)

      const results = res.results.map((r) => {
        const obj = r as Record<string, unknown>
        return {
          id: obj.id,
          type: obj.object,
          title: extractTitle(r),
          url: obj.url,
          lastEdited: obj.last_edited_time,
        }
      })

      return { success: true, data: { count: results.length, results } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- notion_read_page ---

const ReadPageInput = z.object({
  pageId: z.string().describe('Notion page ID'),
})

export const notionReadPage: Tool = {
  name: 'notion_read_page',
  description: "Read a Notion page's content (properties and child blocks).",
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Notion page ID' },
    },
    required: ['pageId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ReadPageInput.parse(input)
      const notion = getClient(ctx)

      const [page, blocks] = await Promise.all([
        notion.pages.retrieve({ page_id: parsed.pageId }),
        notion.blocks.children.list({ block_id: parsed.pageId, page_size: 50 }),
      ])

      const content = blocks.results.map((block) => {
        const b = block as Record<string, unknown>
        const type = b.type as string
        const typeData = b[type] as Record<string, unknown> | undefined
        const richText = typeData?.rich_text as Array<{ plain_text: string }> | undefined
        return {
          type,
          text: richText?.map((t) => t.plain_text).join('') ?? '',
        }
      })

      return {
        success: true,
        data: {
          id: (page as Record<string, unknown>).id,
          title: extractTitle(page),
          content,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- notion_create_page ---

const CreatePageInput = z.object({
  parentPageId: z.string().optional().describe('Parent page ID (for sub-page)'),
  parentDatabaseId: z.string().optional().describe('Parent database ID (for database item)'),
  title: z.string().describe('Page title'),
  content: z.string().optional().describe('Page content as plain text'),
})

export const notionCreatePage: Tool = {
  name: 'notion_create_page',
  description: 'Create a new Notion page under a parent page or database.',
  inputSchema: {
    type: 'object',
    properties: {
      parentPageId: { type: 'string', description: 'Parent page ID' },
      parentDatabaseId: { type: 'string', description: 'Parent database ID' },
      title: { type: 'string', description: 'Page title' },
      content: { type: 'string', description: 'Page content as plain text' },
    },
    required: ['title'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = CreatePageInput.parse(input)
      const notion = getClient(ctx)

      const parent = parsed.parentDatabaseId
        ? { database_id: parsed.parentDatabaseId }
        : { page_id: parsed.parentPageId ?? '' }

      const titleProperty = parsed.parentDatabaseId
        ? { Name: { title: [{ text: { content: parsed.title } }] } }
        : { title: { title: [{ text: { content: parsed.title } }] } }

      const children = parsed.content
        ? [
            {
              object: 'block' as const,
              type: 'paragraph' as const,
              paragraph: {
                rich_text: [{ type: 'text' as const, text: { content: parsed.content } }],
              },
            },
          ]
        : []

      const createParams = {
        parent,
        properties: titleProperty,
        children,
      }

      // Use type assertion to handle the complex union type of CreatePageParameters
      const res = await notion.pages.create(
        createParams as unknown as Parameters<typeof notion.pages.create>[0]
      )

      return {
        success: true,
        data: {
          id: res.id,
          url: (res as Record<string, unknown>).url,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- notion_update_page ---

const UpdatePageInput = z.object({
  pageId: z.string().describe('Page ID to update'),
  content: z.string().describe('Content to append as a new paragraph'),
})

export const notionUpdatePage: Tool = {
  name: 'notion_update_page',
  description: 'Append content to an existing Notion page.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Page ID' },
      content: { type: 'string', description: 'Content to append' },
    },
    required: ['pageId', 'content'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = UpdatePageInput.parse(input)
      const notion = getClient(ctx)

      await notion.blocks.children.append({
        block_id: parsed.pageId,
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: parsed.content } }],
            },
          },
        ],
      })

      return { success: true, data: { updated: true } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- notion_query_database ---

const QueryDatabaseInput = z.object({
  databaseId: z.string().describe('Database ID to query'),
  filter: z.record(z.string(), z.unknown()).optional().describe('Notion filter object'),
  sorts: z.array(z.record(z.string(), z.unknown())).optional().describe('Sort config'),
  pageSize: z.number().optional().default(20),
})

export const notionQueryDatabase: Tool = {
  name: 'notion_query_database',
  description: 'Query a Notion database with optional filters and sorting.',
  inputSchema: {
    type: 'object',
    properties: {
      databaseId: { type: 'string', description: 'Database ID' },
      filter: { type: 'object', description: 'Notion filter object' },
      sorts: { type: 'array', items: { type: 'object' }, description: 'Sort config' },
      pageSize: { type: 'number', description: 'Max results (default 20)' },
    },
    required: ['databaseId'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = QueryDatabaseInput.parse(input)
      const notion = getClient(ctx)

      // Notion SDK v5 uses dataSources.query instead of databases.query
      const queryParams: Parameters<typeof notion.dataSources.query>[0] = {
        data_source_id: parsed.databaseId,
        page_size: parsed.pageSize,
      }
      if (parsed.filter) {
        queryParams.filter = parsed.filter as Parameters<typeof notion.dataSources.query>[0]['filter']
      }
      if (parsed.sorts) {
        queryParams.sorts = parsed.sorts as Parameters<typeof notion.dataSources.query>[0]['sorts']
      }

      const res = await notion.dataSources.query(queryParams)

      const results = res.results.map((page: Record<string, unknown>) => ({
        id: page.id,
        title: extractTitle(page),
        url: page.url,
        lastEdited: page.last_edited_time,
      }))

      return { success: true, data: { count: results.length, results, hasMore: res.has_more } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- notion_create_database_item ---

const CreateDatabaseItemInput = z.object({
  databaseId: z.string().describe('Database ID'),
  properties: z.record(z.string(), z.unknown()).describe('Properties object matching the database schema'),
})

export const notionCreateDatabaseItem: Tool = {
  name: 'notion_create_database_item',
  description: 'Add a new row/page to a Notion database with specified properties.',
  inputSchema: {
    type: 'object',
    properties: {
      databaseId: { type: 'string', description: 'Database ID' },
      properties: { type: 'object', description: 'Properties matching database schema' },
    },
    required: ['databaseId', 'properties'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = CreateDatabaseItemInput.parse(input)
      const notion = getClient(ctx)

      const res = await notion.pages.create({
        parent: { database_id: parsed.databaseId },
        properties: parsed.properties as Parameters<typeof notion.pages.create>[0]['properties'],
      } as Parameters<typeof notion.pages.create>[0])

      return {
        success: true,
        data: {
          id: res.id,
          url: (res as Record<string, unknown>).url,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- helpers ---

function extractTitle(obj: unknown): string {
  const record = obj as Record<string, unknown>
  const props = record.properties as Record<string, unknown> | undefined
  if (!props) return ''

  // Try common title property names
  for (const key of ['Name', 'Title', 'title']) {
    const prop = props[key] as Record<string, unknown> | undefined
    if (prop?.title) {
      const titleArr = prop.title as Array<{ plain_text: string }>
      return titleArr.map((t) => t.plain_text).join('')
    }
  }

  // Fallback: search all properties for a title type
  for (const prop of Object.values(props)) {
    const p = prop as Record<string, unknown>
    if (p.type === 'title' && Array.isArray(p.title)) {
      return (p.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join('')
    }
  }

  return ''
}
