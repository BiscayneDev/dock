'use client'

interface IntegrationCardProps {
  name: string
  icon: string
  description: string
  connected: boolean
  connectUrl: string
  onDisconnect?: () => void
}

export function IntegrationCard({
  name,
  icon,
  description,
  connected,
  connectUrl,
  onDisconnect,
}: IntegrationCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="font-medium text-zinc-100">{name}</h3>
          <p className="text-sm text-zinc-400">{description}</p>
        </div>
      </div>
      <div>
        {connected ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-emerald-400">✅ Connected</span>
            {onDisconnect && (
              <button
                onClick={onDisconnect}
                className="text-sm text-zinc-500 hover:text-red-400 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        ) : (
          <a
            href={connectUrl}
            className="inline-flex items-center rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
          >
            Connect
          </a>
        )}
      </div>
    </div>
  )
}
