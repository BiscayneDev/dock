export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-zinc-950 text-zinc-100 min-h-screen">
      {children}
    </div>
  )
}
