import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// x402 server middleware for gating recipe execution endpoints
// External AI agents can discover and pay for Dock recipes via HTTP 402

interface X402ServerConfig {
  recipientAddress: string
  chain: string
  facilitatorUrl?: string
}

interface PaymentRequired {
  scheme: string
  price: string
  network: string
  payTo: string
  description?: string
  resource?: string
}

// Build the PAYMENT-REQUIRED header value for a recipe
function buildPaymentRequiredHeader(
  feeAmount: number,
  recipientAddress: string,
  chain: string,
  description: string
): PaymentRequired {
  return {
    scheme: 'exact',
    price: `$${feeAmount.toFixed(2)}`,
    network: chain,
    payTo: recipientAddress,
    description,
  }
}

// Verify x402 payment via the facilitator service
async function verifyPayment(
  paymentSignature: string,
  facilitatorUrl: string
): Promise<{ valid: boolean; txHash?: string; error?: string }> {
  try {
    const response = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment: paymentSignature }),
    })

    if (!response.ok) {
      return { valid: false, error: `Facilitator returned ${response.status}` }
    }

    const data = await response.json() as { valid?: boolean; txHash?: string; error?: string }
    return {
      valid: data.valid === true,
      txHash: data.txHash,
      error: data.error,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, error: `Facilitator error: ${msg}` }
  }
}

// Middleware: wrap a recipe execution handler with x402 payment gating
export function withX402RecipeGate(
  handler: (req: NextRequest, recipeId: string) => Promise<NextResponse>,
  config: Partial<X402ServerConfig> = {}
) {
  const facilitatorUrl = config.facilitatorUrl ?? 'https://facilitator.x402.org'

  return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
    const { id: recipeId } = await context.params
    const supabase = createServerClient()

    // Fetch recipe details
    const { data: recipe, error } = await supabase
      .from('recipes')
      .select('id, name, description, fee_amount, fee_required, is_public, user_id, enabled')
      .eq('id', recipeId)
      .single()

    if (error || !recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
    }

    if (!recipe.enabled) {
      return NextResponse.json({ error: 'Recipe is disabled' }, { status: 410 })
    }

    if (!recipe.is_public) {
      return NextResponse.json({ error: 'Recipe is not public' }, { status: 403 })
    }

    // If recipe is free, pass through
    if (!recipe.fee_required || (recipe.fee_amount as number) <= 0) {
      return handler(req, recipeId)
    }

    // Recipe requires payment — check for x402 payment header
    const paymentSignature = req.headers.get('payment-signature')

    if (!paymentSignature) {
      // Return HTTP 402 with payment requirements
      const { data: creator } = await supabase
        .from('users')
        .select('wallet_address, wallet_chain')
        .eq('id', recipe.user_id)
        .single()

      if (!creator?.wallet_address) {
        return NextResponse.json(
          { error: 'Recipe creator has no wallet configured' },
          { status: 500 }
        )
      }

      const chain = (creator.wallet_chain as string) ?? config.chain ?? 'eip155:8453'
      const paymentInfo = buildPaymentRequiredHeader(
        recipe.fee_amount as number,
        creator.wallet_address as string,
        chain,
        `Access to recipe: ${recipe.name as string}`
      )

      const response = NextResponse.json(
        {
          error: 'Payment required',
          recipe: {
            id: recipe.id,
            name: recipe.name,
            description: recipe.description,
            fee: `$${(recipe.fee_amount as number).toFixed(2)} USDC`,
          },
          payment: paymentInfo,
        },
        { status: 402 }
      )

      // Set x402 headers
      response.headers.set('Payment-Required', JSON.stringify(paymentInfo))
      response.headers.set('X-Payment-Scheme', 'exact')
      response.headers.set('X-Payment-Network', chain)
      response.headers.set('X-Payment-Price', `$${(recipe.fee_amount as number).toFixed(2)}`)
      response.headers.set('X-Payment-PayTo', creator.wallet_address as string)

      return response
    }

    // Payment signature present — verify it
    const verification = await verifyPayment(paymentSignature, facilitatorUrl)

    if (!verification.valid) {
      logger.error('x402 payment verification failed', {
        recipeId,
        error: verification.error,
      })

      return NextResponse.json(
        { error: `Payment verification failed: ${verification.error}` },
        { status: 402 }
      )
    }

    // Payment verified — record it in recipe_payments
    const { data: creator } = await supabase
      .from('users')
      .select('id, wallet_address, wallet_chain')
      .eq('id', recipe.user_id)
      .single()

    if (creator) {
      await supabase.from('recipe_payments').insert({
        recipe_id: recipeId,
        payer_id: '00000000-0000-0000-0000-000000000000', // External x402 payer (no Dock account)
        recipient_id: creator.id as string,
        amount: recipe.fee_amount as number,
        currency: 'USDC',
        chain: (creator.wallet_chain as string) ?? 'eip155:8453',
        tx_hash: verification.txHash ?? null,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
    }

    logger.info('x402 payment verified for recipe', {
      recipeId,
      txHash: verification.txHash,
      amount: recipe.fee_amount,
    })

    // Execute the recipe and include payment receipt in response
    const response = await handler(req, recipeId)

    // Add payment receipt header
    response.headers.set('Payment-Response', JSON.stringify({
      success: true,
      txHash: verification.txHash,
      amount: recipe.fee_amount,
      currency: 'USDC',
    }))

    return response
  }
}

// Discovery endpoint helper — returns x402 service info for a recipe
export function buildRecipeServiceInfo(recipe: {
  id: string
  name: string
  description: string | null
  fee_amount: number
  fee_required: boolean
  trigger_type: string
  category: string | null
  run_count: number
}, baseUrl: string) {
  return {
    name: recipe.name,
    description: recipe.description,
    url: `${baseUrl}/api/x402/recipes/${recipe.id}/execute`,
    price: recipe.fee_required ? `$${recipe.fee_amount.toFixed(2)}` : 'free',
    currency: 'USDC',
    network: 'eip155:8453',
    scheme: 'exact',
    category: recipe.category,
    runs: recipe.run_count,
    protocol: 'x402',
  }
}
