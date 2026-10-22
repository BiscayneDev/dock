// Watermark persistence (migration 0011). Server-only: uses the service-role admin client.
// FeedId convention: `schedule:<scheduleId>` — the watermark marks a schedule's last successful tick.

import { adminClient } from "@/lib/tenancy"
import { parseWatermarkRow, NO_WATERMARK, type Watermark } from "@/lib/watermarks"

/** Read the watermark for (ownerId, feedId). Returns NO_WATERMARK when unset. */
export async function getWatermark(ownerId: string, feedId: string): Promise<Watermark> {
  const { data, error } = await adminClient()
    .from("watermarks")
    .select("value")
    .eq("owner_id", ownerId)
    .eq("feed_id", feedId)
    .maybeSingle()
  if (error || !data) return NO_WATERMARK
  return parseWatermarkRow(data as Record<string, unknown> | null)
}

/** Upsert the watermark for (ownerId, feedId) into workspaceId. Throws on DB error. */
export async function setWatermark(
  workspaceId: string,
  ownerId: string,
  feedId: string,
  wm: Watermark,
): Promise<void> {
  const { error } = await adminClient()
    .from("watermarks")
    .upsert(
      {
        workspace_id: workspaceId,
        owner_id: ownerId,
        feed_id: feedId,
        value: { seenAt: wm.seenAt, lastItemId: wm.lastItemId },
      },
      { onConflict: "owner_id,feed_id" },
    )
  if (error) throw new Error(`watermark upsert: ${error.message}`)
}
