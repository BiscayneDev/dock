/** Delivery belongs to the current turn's file queue, not model-written links. */
const HOSTED_URL = /https?:\/\/[a-z0-9-]+\.here\.now\/?[^\s)]*/i
const MADE_CLAIM = /\b(?:I(?:'ve| have)?|we(?:'ve| have)?)\s+(?:compiled|created|made|prepared|updated|put together)\b[\s\S]*\b(?:document|file|page|pdf)\b/i
const DELIVERY_PROMISE = /\b(?:link|file|page|pdf|document)\b[^.!?\n]{0,100}\b(?:will be sent|after your reply|when you(?:'re| are) ready|once you reply)\b/i

export function needsFileRepair(reply: string): boolean {
    return /\[\s*(?:sent )?file:[^\]]*\]/i.test(reply) || MADE_CLAIM.test(reply)
}

/** A fabricated announcement is never sent, even when the repair failed. */
export function fileReply(reply: string, made: number): string {
    if (made > 0 && (HOSTED_URL.test(reply) || DELIVERY_PROMISE.test(reply))) return 'Here you go.'
    if (made === 0 && needsFileRepair(reply)) return 'The document was not made, so there is no new file to send.'
    return reply
}
