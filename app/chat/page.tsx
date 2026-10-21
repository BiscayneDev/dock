import { redirect } from "next/navigation"

// The assistant is the one chat surface now; keep old /chat links working.
export default async function ChatRedirect({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams
  redirect(id ? `/assistant?id=${encodeURIComponent(id)}` : "/assistant")
}
