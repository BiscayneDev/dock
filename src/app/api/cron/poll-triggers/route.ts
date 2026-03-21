import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { checkTrigger } from '@/lib/recipes/trigger-evaluator'
import { isScheduleDue } from '@/lib/recipes/cron-parser'
import { executeRecipe } from '@/lib/recipes/execution-agent'
import { getDecryptedTokens } from '@/lib/orchestrator/index'
import { logger } from '@/lib/logger'
import type { UserContext } from '@/lib/llm/types'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Fetch enabled recipes: schedule + event-based, oldest-checked first
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('*, users!inner(id, telegram_id, name, timezone)')
    .eq('enabled', true)
    .in('trigger_type', ['schedule', 'email_event', 'github_event', 'notion_event'])
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(50)

  if (error || !recipes || recipes.length === 0) {
    return NextResponse.json({ processed: 0, triggered: 0 })
  }

  let triggeredCount = 0

  const results = await Promise.allSettled(
    recipes.map(async (recipe) => {
      try {
        const user = recipe.users as unknown as {
          id: string; telegram_id: number; name: string | null; timezone: string
        }

        // Handle schedule triggers
        if (recipe.trigger_type === 'schedule') {
          const config = recipe.trigger_config as { cron: string; timezone?: string }
          const tz = config.timezone ?? user.timezone ?? 'UTC'

          if (isScheduleDue(config.cron, tz, recipe.last_run_at as string | null)) {
            await executeRecipe(
              {
                id: recipe.id as string,
                user_id: recipe.user_id as string,
                name: recipe.name as string,
                instructions: recipe.instructions as string,
                trigger_type: recipe.trigger_type as string,
                notify_on_run: recipe.notify_on_run as boolean,
                run_count: (recipe.run_count as number) ?? 0,
              },
              { schedule: true, firedAt: new Date().toISOString() }
            )
            triggeredCount++
          }
        } else {
          // Handle event-based triggers (email, github, notion)
          const tokens = await getDecryptedTokens(user.id)
          const ctx: UserContext = {
            userId: user.id,
            telegramId: user.telegram_id,
            telegramChatId: user.telegram_id,
            name: user.name ?? '',
            timezone: user.timezone ?? 'UTC',
            tokens,
          }

          const matches = await checkTrigger(
            {
              id: recipe.id as string,
              user_id: recipe.user_id as string,
              trigger_type: recipe.trigger_type as string,
              trigger_config: recipe.trigger_config,
              last_checked_at: recipe.last_checked_at as string | null,
            },
            ctx
          )

          for (const match of matches) {
            // Dedup: check if already ran for this external ID
            const { count } = await supabase
              .from('recipe_runs')
              .select('*', { count: 'exact', head: true })
              .eq('recipe_id', recipe.id)
              .contains('trigger_context', { externalId: match.externalId })

            if ((count ?? 0) > 0) continue

            await executeRecipe(
              {
                id: recipe.id as string,
                user_id: recipe.user_id as string,
                name: recipe.name as string,
                instructions: recipe.instructions as string,
                trigger_type: recipe.trigger_type as string,
                notify_on_run: recipe.notify_on_run as boolean,
                run_count: (recipe.run_count as number) ?? 0,
              },
              { ...match.context, externalId: match.externalId }
            )
            triggeredCount++
          }
        }
      } finally {
        // Always update last_checked_at
        await supabase
          .from('recipes')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', recipe.id)
      }
    })
  )

  // Log any rejected promises
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error('Poll trigger failed', { error: String(result.reason) })
    }
  }

  return NextResponse.json({
    processed: results.length,
    triggered: triggeredCount,
  })
}
