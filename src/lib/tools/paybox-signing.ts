import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { isPayboxConnected, payboxRequired } from '@/lib/integrations/paybox'
import { mintKeySetupLinks, KEY_LINK_TTL_SECONDS } from '@/lib/integrations/paybox-key-link'

/**
 * iMessage tool: set up (or replace) the PayBox signing key. Returns the two
 * links the user needs; the key itself is pasted on a Dinghy page, never in chat.
 */
export function payboxSigningToolsFor(chatGuid: string): Tool[] {
    const setup: Tool = {
        name: 'paybox_signing_setup',
        description:
            'Get the two links that let the user add a PayBox signing key, so swaps and payments can finish ' +
            'after they approve with their passkey. Use when they ask to enable swaps, sends, payments or ' +
            'signing, or ask how to add/replace their signing key. Never ask them to text the key.',
        inputSchema: { type: 'object', properties: {} },
        async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
            if (!isPayboxConnected(ctx)) return payboxRequired('adding a signing key')
            try {
                const links = await mintKeySetupLinks(ctx.userId, ctx.tokens, chatGuid)
                return {
                    success: true,
                    data: {
                        already_has_key: links.alreadyHasKey,
                        step_1_generate_key: links.generateUrl,
                        step_2_paste_key: links.pasteUrl,
                        paste_link_expires_minutes: Math.round(KEY_LINK_TTL_SECONDS / 60),
                        instruction:
                            'Send both links as-is, each on its own line, in order. Step 1 opens PayBox (the app on a phone): ' +
                            'they generate a signing key for Dinghy and copy it. Suggest setting limits on it there. Step 2 is ' +
                            'where they paste it. One-use, expires in 15 minutes. Tell them never to text the key. ' +
                            (links.alreadyHasKey ? 'They already have a key on file; saving a new one replaces it. ' : '') +
                            'Plain wallet sends still cannot finish after passkey approval (PayBox limitation); swaps and x402 payments can.',
                    },
                }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) }
            }
        },
    }
    return [setup]
}
