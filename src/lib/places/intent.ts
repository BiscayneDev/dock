/**
 * Deterministic trigger for the places page: a "where to eat near X" style ask.
 * Conservative on purpose. It must name something to eat or drink AND a
 * nearness/location cue, and it never fires on a question that is clearly
 * about something else (booking, ordering delivery, recipes).
 */
const FOOD = /\b(eat|eating|food|restaurants?|dinner|lunch|breakfast|brunch|coffee|cafes?|bars?|pubs?|ramen|pizza|sushi|tacos?|noodles?|chicken (?:and )?rice|dim sum|bakery|dessert|ice cream|snack)\b/i
const NEAR = /\b(near(?:by| me| my)?|around|close to|walking distance|next to|by my hotel|in the area|where (?:can|should|do) (?:i|we)|where to|what(?:'s| is) (?:good|nearby)|best .{2,40} in)\b/i
const NOT = /\b(deliver(?:y|ed)?|doordash|uber ?eats|order (?:me|a|some)|recipe|reservation|book a table|cook)\b/i

export function wantsPlaces(text: string): boolean {
    const t = (text ?? '').slice(0, 600)
    return FOOD.test(t) && NEAR.test(t) && !NOT.test(t)
}
