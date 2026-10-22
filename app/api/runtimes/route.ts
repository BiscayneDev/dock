import { NextResponse } from "next/server"
import { listRuntimeNames, runtime } from "@/lib/runtime"
import { listConfiguredProviders, resolveModel, resolveModelRef } from "@/lib/inference"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

export async function GET() {
  const runtimes = listRuntimeNames()
  const active = runtime.name
  const activeId = (runtime as { id?: string }).id ?? "unknown"
  const modelRef = resolveModelRef()
  const vicModel = resolveModel(CHIEF_RUNTIME_KEY)

  return NextResponse.json({
    active: activeId,
    activeName: active,
    available: runtimes,
    inference: {
      defaultModel: modelRef,
      vicModel: vicModel?.label ?? null,
      providers: listConfiguredProviders(),
    },
  })
}
