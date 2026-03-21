import { NextResponse } from 'next/server'
import { RECIPE_TEMPLATES } from '@/lib/recipes/templates'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ templates: RECIPE_TEMPLATES })
}
