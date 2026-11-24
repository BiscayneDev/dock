"use client"

import { useMemo, type ReactNode } from "react"

// Minimal OKF-markdown renderer: headings, lists, quotes, fenced code, tables,
// paragraphs and inline bold/italic/code/links. No external dependency.

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "paragraph"; text: string }

const INLINE_RE = /(\*\*[^*]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`|\[[^\]\n]+?\]\([^)\n]+?\))/g

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11.5px",
  color: "var(--ink)",
  background: "var(--surface-2)",
  border: "1px solid var(--line)",
  borderRadius: "4px",
  padding: "1px 4px",
  whiteSpace: "nowrap",
}

function stripFrontmatter(src: string): string {
  const lines = src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")
  if (lines[0]?.trim() !== "---") return src
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") return lines.slice(i + 1).join("\n")
  }
  return src
}

function isTableSeparator(line: string): boolean {
  const t = line.trim()
  if (!t.includes("|")) return false
  const cells = t
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === "") {
      i += 1
      continue
    }

    const fence = /^([ \t]*)(`{3,}|~{3,})\s*(.*)$/.exec(line)
    if (fence) {
      const marker = fence[2][0]
      const markerLen = fence[2].length
      const closeRe = new RegExp(`^[ \\t]*${marker}{${markerLen},}[ \\t]*$`)
      const buf: string[] = []
      i += 1
      while (i < lines.length && !closeRe.test(lines[i])) {
        buf.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ type: "code", lang: fence[3].trim(), text: buf.join("\n") })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() })
      i += 1
      continue
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ type: "hr" })
      i += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""))
        i += 1
      }
      blocks.push({ type: "quote", lines: buf })
      continue
    }

    const listMatch = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1])
      const items: string[] = []
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (!m || /\d/.test(m[1]) !== ordered) break
        items.push(m[2])
        i += 1
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      blocks.push({ type: "table", header, rows })
      continue
    }

    const para: string[] = [line.trim()]
    i += 1
    while (i < lines.length) {
      const l = lines[i]
      if (l.trim() === "") break
      if (/^(#{1,6})\s+/.test(l.trim())) break
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) break
      if (/^\s*>/.test(l)) break
      if (/^\s*(`{3,}|~{3,})/.test(l)) break
      para.push(l.trim())
      i += 1
    }
    blocks.push({ type: "paragraph", text: para.join(" ") })
  }
  return blocks
}

function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|\/|#|mailto:)/i.test(href.trim())
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = new RegExp(INLINE_RE.source, "g")
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith("**") && token.length > 4) {
      nodes.push(
        <strong key={key++} style={{ color: "var(--ink)" }}>
          {renderInline(token.slice(2, -2))}
        </strong>,
      )
    } else if (token.startsWith("`") && token.length > 2) {
      nodes.push(
        <code key={key++} style={inlineCodeStyle}>
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith("*") && token.length > 2) {
      nodes.push(<em key={key++}>{renderInline(token.slice(1, -1))}</em>)
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link && isSafeHref(link[2])) {
        nodes.push(
          <a
            key={key++}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#93c5fd", textDecoration: "underline", textUnderlineOffset: "2px" }}
          >
            {link[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    } else {
      nodes.push(token)
    }
    last = m.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function Heading({ level, text }: { level: number; text: string }) {
  const size = level <= 1 ? "22px" : level === 2 ? "18px" : level === 3 ? "15px" : "13.5px"
  const serif = level <= 2
  return (
    <h3
      className={serif ? "font-serif" : "font-semibold"}
      style={{
        fontSize: size,
        color: "var(--ink)",
        marginTop: "18px",
        marginBottom: "8px",
        lineHeight: 1.3,
      }}
    >
      {renderInline(text)}
    </h3>
  )
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading":
      return <Heading key={index} level={block.level} text={block.text} />
    case "paragraph":
      return (
        <p key={index} style={{ color: "var(--ink-2)", lineHeight: 1.7, marginBottom: "10px" }}>
          {renderInline(block.text)}
        </p>
      )
    case "code":
      return (
        <div
          key={index}
          className="mb-3 overflow-hidden rounded-[10px]"
          style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
        >
          <div
            className="px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em]"
            style={{ borderBottom: "1px solid var(--line)", color: "var(--ink-3)" }}
          >
            {block.lang || "code"}
          </div>
          <pre
            className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed"
            style={{ color: "var(--ink-2)", margin: 0 }}
          >
            <code>{block.text}</code>
          </pre>
        </div>
      )
    case "list":
      return block.ordered ? (
        <ol
          key={index}
          className="mb-3 list-decimal space-y-1 pl-5 text-[13px]"
          style={{ color: "var(--ink-2)" }}
        >
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul
          key={index}
          className="mb-3 list-disc space-y-1 pl-5 text-[13px]"
          style={{ color: "var(--ink-2)" }}
        >
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    case "quote":
      return (
        <blockquote
          key={index}
          className="mb-3 border-l-2 py-1 pl-4 text-[13px] italic"
          style={{ borderColor: "var(--gold)", color: "var(--ink-2)", whiteSpace: "pre-line" }}
        >
          {block.lines.filter((l) => l.trim() !== "").join("\n")}
        </blockquote>
      )
    case "table":
      return (
        <div
          key={index}
          className="mb-3 overflow-x-auto rounded-[10px]"
          style={{ border: "1px solid var(--line)", background: "var(--surface-0)" }}
        >
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left font-mono text-[9.5px] uppercase tracking-[0.12em]"
                    style={{ color: "var(--ink-3)", borderBottom: "1px solid var(--line)" }}
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="px-3 py-1.5 align-top"
                      style={{ color: "var(--ink-2)", borderTop: "1px solid var(--line)" }}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "hr":
      return <hr key={index} className="my-4 border-none" style={{ borderTop: "1px solid var(--line)" }} />
    default:
      return null
  }
}

export function OkfBody({ source, maxHeight }: { source: string | null | undefined; maxHeight?: number }) {
  const blocks = useMemo(() => parseBlocks(stripFrontmatter(source ?? "")), [source])
  if (blocks.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
        This document has no body content yet.
      </p>
    )
  }
  return (
    <div style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  )
}
