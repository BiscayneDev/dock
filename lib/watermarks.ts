// Pure watermark logic for feed dedup. No imports — this module must stay import-free.

export interface Watermark {
  seenAt: string | null; // ISO timestamp of the newest item already seen
  lastItemId: string | null; // id of the newest item already seen
}

export const NO_WATERMARK: Watermark = { seenAt: null, lastItemId: null };

export function shouldProcess(
  item: { id: string; createdAt: string },
  wm: Watermark,
): boolean {
  if (wm.lastItemId !== null && item.id === wm.lastItemId) return false;
  if (wm.seenAt !== null && item.createdAt <= wm.seenAt) return false;
  return true;
}

export function nextWatermark(
  processed: { id: string; createdAt: string }[],
  current: Watermark,
): Watermark {
  let newest: { id: string; createdAt: string } | null = null;
  for (const item of processed) {
    if (newest === null || item.createdAt > newest.createdAt) newest = item;
  }
  if (newest === null) return current;
  return { lastItemId: newest.id, seenAt: newest.createdAt };
}

export function parseWatermarkRow(row: Record<string, unknown> | null): Watermark {
  if (row === null || typeof row !== 'object') return NO_WATERMARK;
  const value = row.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return NO_WATERMARK;
  const v = value as Record<string, unknown>;
  const seenAt = v.seenAt;
  const lastItemId = v.lastItemId;
  if (typeof seenAt !== 'string' || typeof lastItemId !== 'string') return NO_WATERMARK;
  return { seenAt, lastItemId };
}
