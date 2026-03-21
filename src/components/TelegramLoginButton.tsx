'use client'

import { useEffect, useRef, useCallback } from 'react'

interface TelegramAuthData {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthData) => void
  }
}

interface TelegramLoginButtonProps {
  botName: string
  onAuth: (data: TelegramAuthData) => void
}

export function TelegramLoginButton({ botName, onAuth }: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scriptAdded = useRef(false)
  const onAuthRef = useRef(onAuth)
  onAuthRef.current = onAuth

  const handleAuth = useCallback((user: TelegramAuthData) => {
    onAuthRef.current(user)
  }, [])

  useEffect(() => {
    if (scriptAdded.current) return
    scriptAdded.current = true

    window.onTelegramAuth = handleAuth

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', botName)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true

    containerRef.current?.appendChild(script)

    return () => {
      delete window.onTelegramAuth
    }
  }, [botName, handleAuth])

  return <div ref={containerRef} />
}

export type { TelegramAuthData }
