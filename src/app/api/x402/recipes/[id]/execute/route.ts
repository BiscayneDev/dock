import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { withX402RecipeGate } from '@/lib/x402/server'
import { logger } from '@/lib/logger'

// x402-gated recipe execution endpoint
// External AI agents can discover this via the /api/x402/discover endpoint
// and pay for recipe execution using the x402 protocol.

async function executeRecipeHandler(
  req: NextRequest,
  recipeId: string
): Promise<NextResponse> {
  const supabase = createServerClient()

  // Fetch the full recipe
  const { data: recipe, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', recipeId)
    .single()

  if (error || !recipe) {
    return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
  }

  // Parse optional input from request body
  let userInput: string | null = null
  try {
    const body = await req.json() as { input?: string }
    userInput = body.input ?? null
  } catch {
    // No body or invalid JSON — that's fine for most recipes
  }

  // Create a recipe run record
  const { data: run, error: runError } = await supabase
    .from('recipe_runs')
    .insert({
      recipe_id: recipeId,
      status: 'running',
      trigger_source: 'x402',
      input_data: userInput ? { input: userInput } : null,
    })
    .select('id')
    .single()

  if (runError || !run) {
    logger.error('Failed to create x402 recipe run', { recipeId, error: runError?.message })
    return NextResponse.json({ error: 'Failed to start recipe run' }, { status: 500 })
  }

  // Increment run count
  try {
    await supabase.rpc('increment_run_count', { recipe_id: recipeId })
  } catch {
    logger.error('Failed to increment run count', { recipeId })
  }

  // For x402 execution, we run the recipe instructions through the LLM
  // with available tools, similar to the execution agent but in a single pass.
  try {
    const { getLLMProvider } = await import('@/lib/llm')
    const { buildSystemPrompt } = await import('@/lib/orchestrator/system-prompt')
    const { executionAgentTools } = await import('@/lib/tools')
    const { runAgentLoop } = await import('@/lib/llm/agent-loop')

    // Get recipe creator's context for tool access
    const { data: creator } = await supabase
      .from('users')
      .select('id, name, timezone, telegram_id, wallet_address, wallet_chain')
      .eq('id', recipe.user_id)
      .single()

    if (!creator) {
      await supabase
        .from('recipe_runs')
        .update({ status: 'failed', error: 'Creator not found', completed_at: new Date().toISOString() })
        .eq('id', run.id)

      return NextResponse.json({ error: 'Recipe creator not found' }, { status: 500 })
    }

    // Build execution context
    const systemPrompt = `You are executing a recipe via the x402 protocol. Follow the recipe instructions precisely.\n\nRecipe: ${recipe.name as string}\nInstructions: ${recipe.instructions as string}${userInput ? `\n\nUser input: ${userInput}` : ''}`

    const provider = getLLMProvider()
    const userContext = {
      userId: creator.id as string,
      telegramId: creator.telegram_id as number,
      telegramChatId: 0, // No Telegram context for x402 execution
      name: (creator.name as string) ?? 'User',
      timezone: (creator.timezone as string) ?? 'UTC',
      tokens: {},
    }

    const result = await runAgentLoop(
      systemPrompt,
      [{ role: 'user', content: `Execute recipe: ${recipe.name as string}${userInput ? `\nInput: ${userInput}` : ''}` }],
      executionAgentTools,
      userContext
    )

    // Mark run as successful
    await supabase
      .from('recipe_runs')
      .update({
        status: 'success',
        output_data: { result },
        completed_at: new Date().toISOString(),
      })
      .eq('id', run.id)

    return NextResponse.json({
      success: true,
      runId: run.id,
      result,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('x402 recipe execution failed', { recipeId, runId: run.id, error: errorMsg })

    await supabase
      .from('recipe_runs')
      .update({
        status: 'failed',
        error: errorMsg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', run.id)

    return NextResponse.json(
      { success: false, error: 'Recipe execution failed' },
      { status: 500 }
    )
  }
}

// Wrap the handler with x402 payment gating
export const POST = withX402RecipeGate(executeRecipeHandler)

// GET returns recipe info and payment requirements (always returns 402 for paid recipes)
export const GET = withX402RecipeGate(
  async (_req: NextRequest, recipeId: string) => {
    const supabase = createServerClient()
    const { data: recipe } = await supabase
      .from('recipes')
      .select('id, name, description, trigger_type, category, fee_amount, fee_required, run_count')
      .eq('id', recipeId)
      .single()

    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
    }

    return NextResponse.json({
      recipe: {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        trigger_type: recipe.trigger_type,
        category: recipe.category,
        fee: recipe.fee_required ? `$${(recipe.fee_amount as number).toFixed(2)} USDC` : 'free',
        runs: recipe.run_count,
        protocol: 'x402',
      },
    })
  }
)

// CORS preflight for external AI agents
export async function OPTIONS(): Promise<NextResponse> {
  const response = new NextResponse(null, { status: 204 })
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Payment-Signature, Payment-Required')
  return response
}
