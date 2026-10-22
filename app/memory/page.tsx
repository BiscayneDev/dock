"use client"

import { useEffect, useState, useCallback } from "react"

const PURPLE = "#7c3aed"

interface MemoryFile {
  name: string
  date: string
  pinned: boolean
  size: number
  modified: string
}

interface MemoryListResponse {
  files: MemoryFile[]
  lastUpdated: string | null
}

interface MemoryContentResponse {
  name: string
  content: string
  date: string
}

function formatDate(date: string): string {
  if (date === "MEMORY") return "Long-Term Memory"
  // Try to parse YYYY-MM-DD or YYYY-MM-DD-slug
  const match = date.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match) return date
  try {
    const d = new Date(match[1] + "T00:00:00")
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return date
  }
}

function getTodayKey(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// Simple inline markdown renderer — no heavy deps
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n")
  const nodes: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // H1
    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={i} className="text-lg font-bold text-white mt-4 mb-1">
          {inlineMarkdown(line.slice(2))}
        </h1>
      )
      continue
    }

    // H2
    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={i} className="text-base font-semibold mt-3 mb-1" style={{ color: "#c4b5fd" }}>
          {inlineMarkdown(line.slice(3))}
        </h2>
      )
      continue
    }

    // H3
    if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={i} className="text-sm font-semibold text-zinc-300 mt-2 mb-0.5">
          {inlineMarkdown(line.slice(4))}
        </h3>
      )
      continue
    }

    // Bullet
    if (line.startsWith("- ") || line.startsWith("* ")) {
      nodes.push(
        <li key={i} className="text-xs text-zinc-400 ml-4 leading-relaxed list-disc">
          {inlineMarkdown(line.slice(2))}
        </li>
      )
      continue
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      nodes.push(<hr key={i} className="border-zinc-800 my-3" />)
      continue
    }

    // Empty line
    if (line.trim() === "") {
      nodes.push(<div key={i} className="h-1.5" />)
      continue
    }

    // Regular paragraph
    nodes.push(
      <p key={i} className="text-xs text-zinc-400 leading-relaxed">
        {inlineMarkdown(line)}
      </p>
    )
  }

  return nodes
}

// Handle inline bold **text** and `code`
function inlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let idx = 0

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    const codeMatch = remaining.match(/`(.+?)`/)

    const boldIdx = boldMatch?.index ?? Infinity
    const codeIdx = codeMatch?.index ?? Infinity

    if (boldIdx === Infinity && codeIdx === Infinity) {
      parts.push(<span key={idx++}>{remaining}</span>)
      break
    }

    if (boldIdx <= codeIdx && boldMatch) {
      if (boldMatch.index! > 0) {
        parts.push(<span key={idx++}>{remaining.slice(0, boldMatch.index)}</span>)
      }
      parts.push(
        <strong key={idx++} className="text-zinc-200 font-semibold">
          {boldMatch[1]}
        </strong>
      )
      remaining = remaining.slice(boldMatch.index! + boldMatch[0].length)
    } else if (codeMatch) {
      if (codeMatch.index! > 0) {
        parts.push(<span key={idx++}>{remaining.slice(0, codeMatch.index)}</span>)
      }
      parts.push(
        <code
          key={idx++}
          className="px-1 py-0.5 rounded text-xs font-mono"
          style={{ backgroundColor: "rgba(124,58,237,0.15)", color: "#c4b5fd" }}
        >
          {codeMatch[1]}
        </code>
      )
      remaining = remaining.slice(codeMatch.index! + codeMatch[0].length)
    }
  }

  return <>{parts}</>
}

export default function MemoryPage() {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<string>("")
  const [contentLoading, setContentLoading] = useState(false)

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/memory", { cache: "no-store" })
      const data: MemoryListResponse = await res.json()
      setFiles(data.files ?? [])
      return data.files ?? []
    } catch {
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const loadFile = useCallback(async (key: string) => {
    setSelectedFile(key)
    setContentLoading(true)
    setContent("")
    try {
      const res = await fetch(`/api/memory?file=${encodeURIComponent(key)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        setContent("*File not found.*")
        return
      }
      const data: MemoryContentResponse = await res.json()
      setContent(data.content ?? "")
    } catch {
      setContent("*Error loading file.*")
    } finally {
      setContentLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles().then((fetchedFiles) => {
      // Auto-load today's file if it exists
      const today = getTodayKey()
      const todayFile = fetchedFiles.find((f) => f.date.startsWith(today))
      if (todayFile) {
        loadFile(todayFile.date)
      } else if (fetchedFiles.length > 0) {
        // Fall back to most recent non-pinned
        const first = fetchedFiles.find((f) => !f.pinned)
        if (first) loadFile(first.date)
      }
    })
  }, [fetchFiles, loadFile])

  const selectedLabel =
    selectedFile === "MEMORY"
      ? "Long-Term Memory"
      : selectedFile
      ? formatDate(selectedFile)
      : "Select a file"

  return (
    <div className="max-w-6xl mx-auto h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">🧠</span>
        <div>
          <h1 className="text-2xl font-bold text-white leading-none">Memory</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Your chief of staff&apos;s working and long-term memory</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-zinc-600 text-sm">Loading memory files...</p>
        </div>
      ) : files.length === 0 ? (
        <div
          className="rounded-xl p-10 text-center space-y-3"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          <p className="text-3xl">🧠</p>
          <p className="text-zinc-400 font-medium">No memory files found</p>
          <p className="text-xs text-zinc-600">
            Memory files live in{" "}
            <code className="text-zinc-500">~/clawd/memory/</code> and{" "}
            <code className="text-zinc-500">~/clawd/MEMORY.md</code>
          </p>
        </div>
      ) : (
        <div className="flex gap-3 flex-1 min-h-0" style={{ height: "calc(100vh - 160px)" }}>
          {/* Left panel — file list */}
          <div
            className="w-52 shrink-0 rounded-xl overflow-hidden flex flex-col"
            style={{
              backgroundColor: "#111118",
              border: `1px solid ${PURPLE}28`,
            }}
          >
            <div
              className="px-3 py-2.5 border-b text-xs font-mono uppercase tracking-wider text-zinc-500"
              style={{ borderColor: `${PURPLE}20` }}
            >
              Files
            </div>
            <div className="overflow-y-auto flex-1">
              {files.map((file) => {
                const isSelected = selectedFile === file.date
                return (
                  <button
                    key={file.date}
                    onClick={() => loadFile(file.date)}
                    className="w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2 border-b border-zinc-800/30 last:border-0"
                    style={{
                      backgroundColor: isSelected
                        ? `${PURPLE}20`
                        : "transparent",
                    }}
                  >
                    {file.pinned && (
                      <span className="text-sm shrink-0">📌</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-medium truncate"
                        style={{ color: isSelected ? "#c4b5fd" : "#a1a1aa" }}
                      >
                        {file.pinned ? "MEMORY.md" : formatDate(file.date)}
                      </p>
                      {!file.pinned && (
                        <p className="text-[10px] text-zinc-700 truncate font-mono">
                          {file.date}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right panel — content */}
          <div
            className="flex-1 rounded-xl overflow-hidden flex flex-col min-w-0"
            style={{
              backgroundColor: "#111118",
              border: `1px solid ${PURPLE}28`,
            }}
          >
            {/* Content header */}
            <div
              className="flex items-center justify-between px-5 py-2.5 border-b shrink-0"
              style={{ borderColor: `${PURPLE}20` }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: PURPLE, boxShadow: `0 0 6px ${PURPLE}` }}
                />
                <p className="text-xs font-mono text-zinc-400 truncate">{selectedLabel}</p>
              </div>
              {selectedFile && selectedFile !== "MEMORY" && (
                <p className="text-[10px] text-zinc-700 font-mono shrink-0 ml-2">
                  {selectedFile}
                </p>
              )}
            </div>

            {/* Content body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {contentLoading ? (
                <p className="text-zinc-600 text-xs">Loading...</p>
              ) : !selectedFile ? (
                <p className="text-zinc-700 text-xs">Select a file to view</p>
              ) : content === "" ? (
                <p className="text-zinc-700 text-xs">Empty file</p>
              ) : (
                <div className="space-y-0.5">{renderMarkdown(content)}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
