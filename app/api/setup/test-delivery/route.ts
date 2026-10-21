import { NextResponse } from "next/server"
import { runtime } from "@/lib/runtime"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { channel, target } = body as { channel: string; target: string }

    if (!channel || !target) {
      return NextResponse.json({ ok: false, error: "Channel and target are required" })
    }

    try {
      await runtime.testDelivery(channel, target, "👋 Dock setup — connection test successful!")
      return NextResponse.json({ ok: true })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Failed to send message"
      return NextResponse.json({ ok: false, error: errMsg })
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }
}
