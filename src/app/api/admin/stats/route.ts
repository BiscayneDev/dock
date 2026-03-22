import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth/admin'

export async function GET(): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const supabase = createServerClient()

  // Run all queries in parallel
  const [
    usersResult,
    messagesResult,
    recipesResult,
    runsResult,
    tokensResult,
    remindersResult,
    activeUsersResult,
    runStatusResult,
    triggerTypeResult,
    recentUsersResult,
    topRecipesResult,
    avgDurationResult,
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('recipes').select('*', { count: 'exact', head: true }),
    supabase.from('recipe_runs').select('*', { count: 'exact', head: true }),
    supabase.from('oauth_tokens').select('*', { count: 'exact', head: true }),
    supabase.from('reminders').select('*', { count: 'exact', head: true }).eq('fired', false),

    // Active users (last 7 days)
    supabase.from('messages')
      .select('user_id')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),

    // Run status breakdown
    supabase.from('recipe_runs').select('status'),

    // Recipes by trigger type
    supabase.from('recipes').select('trigger_type'),

    // Recent signups (last 30 days)
    supabase.from('users')
      .select('id, name, telegram_username, created_at')
      .order('created_at', { ascending: false })
      .limit(20),

    // Top recipes by run count
    supabase.from('recipes')
      .select('id, name, run_count, trigger_type, user_id, enabled')
      .order('run_count', { ascending: false })
      .limit(10),

    // Average run duration
    supabase.from('recipe_runs')
      .select('duration_ms')
      .not('duration_ms', 'is', null),
  ])

  // Count active users (distinct user_ids in last 7 days)
  const activeUserIds = new Set(
    (activeUsersResult.data ?? []).map((m) => m.user_id as string)
  )

  // Status breakdown
  const statusCounts: Record<string, number> = {}
  for (const run of runStatusResult.data ?? []) {
    const s = run.status as string
    statusCounts[s] = (statusCounts[s] ?? 0) + 1
  }

  // Trigger type breakdown
  const triggerCounts: Record<string, number> = {}
  for (const recipe of triggerTypeResult.data ?? []) {
    const t = recipe.trigger_type as string
    triggerCounts[t] = (triggerCounts[t] ?? 0) + 1
  }

  // Integration breakdown
  const integrationCounts: Record<string, number> = {}
  // We already have token count, but need provider breakdown
  const { data: tokensByProvider } = await supabase
    .from('oauth_tokens')
    .select('provider')
  for (const token of tokensByProvider ?? []) {
    const p = token.provider as string
    integrationCounts[p] = (integrationCounts[p] ?? 0) + 1
  }

  // Average duration
  const durations = (avgDurationResult.data ?? [])
    .map((r) => r.duration_ms as number)
    .filter((d) => d > 0)
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0

  return NextResponse.json({
    overview: {
      totalUsers: usersResult.count ?? 0,
      activeUsers7d: activeUserIds.size,
      totalMessages: messagesResult.count ?? 0,
      totalRecipes: recipesResult.count ?? 0,
      totalRuns: runsResult.count ?? 0,
      totalIntegrations: tokensResult.count ?? 0,
      activeReminders: remindersResult.count ?? 0,
      avgRunDurationMs: avgDuration,
    },
    runsByStatus: statusCounts,
    recipesByTrigger: triggerCounts,
    integrationsByProvider: integrationCounts,
    recentUsers: recentUsersResult.data ?? [],
    topRecipes: topRecipesResult.data ?? [],
  })
}
