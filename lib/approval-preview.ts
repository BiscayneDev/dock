import type { SupabaseClient } from "@supabase/supabase-js"
import { captureUrl } from "@/lib/preview-capture"
import { capturePreviewForApproval, PREVIEW_BUCKET, PREVIEW_URL_TTL_SECONDS, type PreviewOutcome } from "@/lib/preview-guard"

// Wires the approval screenshot into the worker gate. One capture per approval request.
// Storage: private bucket approval-previews, written with the service role. Reads go through a fresh signed URL.

/** Captures the proposed page for an approval and stores it. Never throws; failures come back as a reason. */
export async function captureApprovalPreview(
  admin: SupabaseClient,
  input: { ownerId: string; runId: string; target: unknown },
): Promise<PreviewOutcome> {
  return capturePreviewForApproval(input, {
    capture: captureUrl,
    now: () => Date.now(),
    store: async (path, png) => {
      const { error } = await admin.storage.from(PREVIEW_BUCKET).upload(path, png, {
        contentType: "image/png",
        upsert: false,
      })
      return !error
    },
    sign: async (path, ttl) => {
      const { data, error } = await admin.storage.from(PREVIEW_BUCKET).createSignedUrl(path, ttl)
      return error || !data ? null : data.signedUrl
    },
  })
}

/** Fresh read URL for a stored preview. Called only after the owner check in previewAccess(). */
export async function signPreviewPath(admin: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await admin.storage.from(PREVIEW_BUCKET).createSignedUrl(path, PREVIEW_URL_TTL_SECONDS)
  return error || !data ? null : data.signedUrl
}
