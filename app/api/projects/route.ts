import {NextResponse} from "next/server"
import {fetchProjects} from "@/lib/projects-source"
export async function GET() {
  return NextResponse.json(await fetchProjects(), { status: 200 })
}
