/**
 * Deterministic trigger for the places page: a "where to eat near X" style ask.
 * Conservative on purpose. It must name something to eat or drink AND a
 * nearness/location cue, and it never fires on a question that is clearly
 * about something else (booking, ordering delivery, recipes).
 */
const FOOD = /\b(eat|eating|food|restaurants?|dinner|lunch|breakfast|brunch|coffee|cafes?|bars?|pubs?|ramen|pizza|sushi|tacos?|noodles?|chicken (?:and )?rice|dim sum|bakery|dessert|ice cream|snack)\b/i
const NEAR = /\b(near(?:by| me| my)?|around|close to|walking distance|next to|by my hotel|in the area|where (?:can|should|do) (?:i|we)|where to|what(?:'s| is) (?:good|nearby)|best .{2,40} in)\b/i
/** Booking intent is separate from nearby discovery, including indirect requests. */
export function wantsRestaurantBooking(text: string): boolean {
    return /\b(reserv(?:e|ation|ations)|book(?:ing)?\s+(?:me\s+)?(?:(?:a|the)\s+)?(?:table|restaurant|dinner|lunch|meal)|get\s+(?:me\s+)?(?:a\s+)?table)\b/i.test(text)
}

const NOT = /\b(deliver(?:y|ed)?|doordash|uber ?eats|order (?:me|a|some)|recipe|reservation|book a table|cook)\b/i

export function wantsPlaces(text: string): boolean {
    const t = (text ?? '').slice(0, 600)
    return FOOD.test(t) && NEAR.test(t) && !NOT.test(t) && !wantsRestaurantBooking(t)
}

/** Never relabel nearby fallback eateries as cuisine matches. No booking or payment effects. */
export function unmatchedPlacesReply(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>
    if (d.matched !== false) return null
    const note = typeof d.note === 'string' ? d.note.trim() : ''
    return `${note || 'The map data did not confirm a match for the requested food. These are nearby eateries instead.'} ${d.page === 'will_send_after_reply' ? 'The page lists nearby alternatives, not verified matches.' : 'The page did not go out.'}`
}
