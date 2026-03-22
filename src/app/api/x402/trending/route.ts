import { NextRequest, NextResponse } from 'next/server'

interface X402Service {
  name: string
  description: string
  url: string
  price: number | null
  category: string | null
  recipe_idea: string
}

// Simple in-memory cache (1 hour TTL)
let cachedServices: X402Service[] | null = null
let cacheExpiry = 0

function generateRecipeIdea(name: string, description: string): string {
  const lower = (name + ' ' + description).toLowerCase()

  if (lower.includes('weather')) return 'Get a daily weather briefing for your city every morning'
  if (lower.includes('news') || lower.includes('headlines')) return 'Send me a digest of top headlines every evening'
  if (lower.includes('stock') || lower.includes('price') || lower.includes('market')) return 'Alert me when a stock I follow moves more than 5%'
  if (lower.includes('translate') || lower.includes('language')) return 'Auto-translate important emails from international contacts'
  if (lower.includes('summarize') || lower.includes('summary')) return 'Summarize long email threads before my meetings'
  if (lower.includes('image') || lower.includes('generate') || lower.includes('ai')) return 'Generate a weekly visual report of my project status'
  if (lower.includes('search') || lower.includes('web')) return 'Research competitors and send me a weekly briefing'
  if (lower.includes('data') || lower.includes('analytics')) return 'Pull daily analytics and post a summary to Notion'
  if (lower.includes('deploy') || lower.includes('build') || lower.includes('ci')) return 'Notify me when a deployment fails with build log summary'
  if (lower.includes('monitor') || lower.includes('uptime')) return 'Check my sites every hour and alert me if any go down'
  if (lower.includes('email') || lower.includes('mail')) return 'Auto-categorize and prioritize my incoming emails'
  if (lower.includes('calendar') || lower.includes('schedule')) return 'Find free time and suggest meeting slots to contacts'
  if (lower.includes('crypto') || lower.includes('blockchain') || lower.includes('token')) return 'Daily portfolio balance check with price alerts'

  return `Build a recipe that uses ${name} to automate a task`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')

  // Return cached if fresh
  if (cachedServices && Date.now() < cacheExpiry) {
    const filtered = category
      ? cachedServices.filter((s) => s.category?.toLowerCase() === category.toLowerCase())
      : cachedServices
    return NextResponse.json({ services: filtered })
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const url = new URL('https://www.x402index.com/api/all')
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Dock/1.0 (marketplace)',
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return NextResponse.json({ services: [], note: 'x402 Index unavailable' })
    }

    const data = await response.json()
    const raw = Array.isArray(data) ? data : (data as Record<string, unknown>).services ?? []
    const services: X402Service[] = (Array.isArray(raw) ? raw : []).slice(0, 30).map((s: Record<string, unknown>) => {
      const name = (s.name ?? s.title ?? 'Unknown') as string
      const description = (s.description ?? '') as string
      return {
        name,
        description,
        url: (s.url ?? s.endpoint ?? '') as string,
        price: (s.price ?? s.cost ?? null) as number | null,
        category: (s.category ?? null) as string | null,
        recipe_idea: generateRecipeIdea(name, description),
      }
    })

    // Cache for 1 hour
    cachedServices = services
    cacheExpiry = Date.now() + 60 * 60 * 1000

    const filtered = category
      ? services.filter((s) => s.category?.toLowerCase() === category.toLowerCase())
      : services

    return NextResponse.json({ services: filtered })
  } catch {
    return NextResponse.json({ services: [], note: 'Failed to fetch x402 services' })
  }
}
