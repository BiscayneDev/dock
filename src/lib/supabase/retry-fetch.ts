/**
 * Fetch wrapper for the Supabase client that retries transient transport
 * failures. The Vercel -> Supabase path flakes several times an hour
 * ("TypeError: fetch failed", ECONNRESET before TLS); without a retry one
 * blip kills the request's whole tail. Only transport errors retry — HTTP
 * responses (4xx/5xx) come back to the caller as-is.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** undici surfaces every socket-level failure as TypeError: fetch failed. */
function isTransportError(err: unknown): boolean {
    return err instanceof TypeError
}

const BACKOFF_MS = [300, 1000, 3000]

export async function retryFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
        try {
            return await fetch(input, init)
        } catch (err) {
            if (!isTransportError(err)) throw err
            lastErr = err
            if (attempt < BACKOFF_MS.length) {
                console.error(
                    `supabase fetch failed (attempt ${attempt + 1}/4), retrying in ${BACKOFF_MS[attempt]}ms:`,
                    err instanceof Error ? err.message : String(err)
                )
                await sleep(BACKOFF_MS[attempt])
            }
        }
    }
    throw lastErr
}
