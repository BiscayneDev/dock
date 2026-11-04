import { EventEmitter } from "events"

export interface NotificationPayload {
  id: string
  agent: string
  message: string
  type: "start" | "finish" | "fail" | "approval" | "info"
  timestamp: number
}

// Singleton emitter — bridges POST /api/notify → GET /api/notify/stream
class NotificationEmitter extends EventEmitter {}

// Global singleton (works in Next.js dev + prod with single process)
const globalForEmitter = global as typeof global & {
  _notificationEmitter?: NotificationEmitter
  _recentNotifications?: NotificationPayload[]
}

if (!globalForEmitter._notificationEmitter) {
  globalForEmitter._notificationEmitter = new NotificationEmitter()
  globalForEmitter._notificationEmitter.setMaxListeners(100)
}

if (!globalForEmitter._recentNotifications) {
  globalForEmitter._recentNotifications = []
}

export const notificationEmitter = globalForEmitter._notificationEmitter
export const recentNotifications = globalForEmitter._recentNotifications

export function addRecentNotification(payload: NotificationPayload): void {
  recentNotifications.unshift(payload)
  // Keep last 5
  if (recentNotifications.length > 5) {
    recentNotifications.splice(5)
  }
}
