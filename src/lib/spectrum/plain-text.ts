/**
 * iMessage doesn't render markdown: **bold** shows up as literal asterisks.
 * Every text Dinghy sends goes through toPlainText at the send boundary so
 * model output (or any string) reaches people as clean plain text.
 *
 * Conservative on purpose: URLs, emails, snake_case and math-ish asterisks
 * ("2 * 3") are left alone.
 */

const URLISH = /(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)/g

function protectUrls(s: string): { text: string; restore: (t: string) => string } {
    const saved: string[] = []
    const text = s.replace(URLISH, (m) => {
        saved.push(m)
        return `\u0000${saved.length - 1}\u0000`
    })
    return { text, restore: (t) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[Number(i)]) }
}

export function toPlainText(input: string): string {
    if (!input) return input
    let s = input.replace(/\r\n/g, '\n')

    // Fenced code blocks: keep the code, drop the fences.
    s = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code: string) => code.replace(/\n$/, ''))

    // Links: [text](url) -> "text (url)", or just the url when they match.
    s = s.replace(/!?\[([^\]\n]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g, (_, text: string, url: string) => {
        const t = text.trim()
        if (!t || t === url || t.replace(/^https?:\/\//, '') === url.replace(/^https?:\/\//, '')) return url
        return `${t} (${url})`
    })

    const { text, restore } = protectUrls(s)
    s = text

    s = s
        .split('\n')
        .map((line) => {
            let l = line
            // Headings and blockquotes.
            l = l.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, (m) => (/^#{1,6}\s/.test(line.trimStart()) ? '' : m))
            l = l.replace(/^\s{0,3}>\s?/, '')
            // Horizontal rules.
            if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) return ''
            // Bullets: "* item" / "+ item" -> "- item".
            l = l.replace(/^(\s*)[*+]\s+/, '$1- ')
            return l
        })
        .join('\n')

    // Bold / strong: **x**, __x__.
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
    s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?=[^\w]|$)/g, '$1$2')
    // Strikethrough.
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    // Italic: *x* and _x_ only when they wrap a word-ish span.
    s = s.replace(/(^|[\s([{"'])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=[\s.,;:!?)\]}"']|$)/gm, '$1$2')
    s = s.replace(/(^|[\s([{"'])_(?=[^\s_])([^_\n]*?[^\s_])_(?=[\s.,;:!?)\]}"']|$)/gm, '$1$2')
    // Inline code.
    s = s.replace(/`([^`\n]+)`/g, '$1')

    s = restore(s)
    return s.replace(/\n{3,}/g, '\n\n').trim()
}
