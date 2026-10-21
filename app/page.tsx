import { redirect } from "next/navigation"
import { readFile } from "fs/promises"
import { join } from "path"

interface SetupData {
  completed?: boolean
}

async function isSetupComplete(): Promise<boolean> {
  try {
    const raw = await readFile(join(process.cwd(), "data", "setup.json"), "utf-8")
    const data = JSON.parse(raw) as SetupData
    return data.completed === true
  } catch {
    return false
  }
}

export default async function Home() {
  const setupDone = await isSetupComplete()
  if (!setupDone) {
    redirect("/setup")
  }
  redirect("/assistant")
}
