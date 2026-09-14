import { type ParsedMemoryCommand } from "../../utils/memory-command"
import type { CodeContext } from "../../hooks/useCodeContext"
import type { BrowserElement } from "../../hooks/useBrowserElements"

export function codeContextToken(c: CodeContext): string {
  const file = fileName(c.path)
  const lines =
    c.startLine !== undefined && c.endLine !== undefined
      ? c.startLine === c.endLine
        ? `${c.startLine}`
        : `${c.startLine}-${c.endLine}`
      : c.startLine !== undefined
        ? `${c.startLine}`
        : ""
  const suffix = lines ? `:${lines}` : ""
  return `[file:${file}${suffix}]`
}

export function browserElementToken(b: BrowserElement): string {
  return `[el:${b.label}]`
}

export function isInlineContextToken(token: string): boolean {
  return token.startsWith("[file:") || token.startsWith("[el:")
}

export function formatCodeContext(c: CodeContext): string {
  return `${c.path}:${c.startLine}-${c.endLine}\n\`\`\`\n${c.text}\n\`\`\``
}

export function buildPromptMessage(
  draft: string,
  contexts: CodeContext[] = [],
  reviewMarkdown = "",
  browserElements: BrowserElement[] = [],
): string {
  let message = draft

  for (const c of contexts) {
    const token = codeContextToken(c)
    if (message.includes(token)) {
      message = message.split(token).join(`\n\n${formatCodeContext(c)}\n\n`)
    }
  }

  for (const b of browserElements) {
    const token = browserElementToken(b)
    if (message.includes(token)) {
      message = message.split(token).join(`\n\n${b.text}\n\n`)
    }
  }

  const cleaned = message.replace(/\n{3,}/g, "\n\n").trim()
  return cleaned && reviewMarkdown ? `${reviewMarkdown}\n\n${cleaned}` : cleaned || reviewMarkdown
}

export type SandboxDefaultState = {
  desired: boolean
  enabled: boolean
  available: boolean
  reason?: string
  revision: number
}

export type SandboxState = {
  sessionID: string
  enabled: boolean
  available: boolean
  reason?: string
  version: number
  directory: string
  revision: number
}

export function applySandboxState(current: SandboxState | undefined, next: SandboxState) {
  if (!current) return next
  const same = current.sessionID === next.sessionID && current.directory === next.directory
  if (same && current.version > next.version) return current
  if (same && current.version === next.version && current.revision > next.revision) return current
  if (!same && current.revision > next.revision) return current
  return next
}

export function applySandboxStates(current: Record<string, SandboxState>, next: SandboxState) {
  const previous = current[next.sessionID]
  const state = applySandboxState(previous, next)
  if (state === previous) return current
  return { ...current, [next.sessionID]: state }
}

export function fileName(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").pop() ?? normalized
}

export function dirName(path: string): string {
  const parts = path.replaceAll("\\", "/").replace(/\/+$/, "").split("/")
  if (parts.length <= 1) return ""
  const dir = parts.slice(0, -1).join("/")
  return dir.length > 30 ? `…/${parts.slice(-3, -1).join("/")}` : dir
}

export function buildHighlightSegments(val: string, paths: Set<string>): { text: string; highlight: boolean }[] {
  if (paths.size === 0) return [{ text: val, highlight: false }]

  const segments: { text: string; highlight: boolean }[] = []
  let remaining = val

  while (remaining.length > 0) {
    let earliest = -1
    let earliestToken = ""

    for (const path of paths) {
      const token = path.startsWith("@") || path.startsWith("[") ? path : `@${path}`
      const idx = remaining.indexOf(token)
      if (idx !== -1 && (earliest === -1 || idx < earliest)) {
        earliest = idx
        earliestToken = token
      }
    }

    if (earliest === -1) {
      segments.push({ text: remaining, highlight: false })
      break
    }

    if (earliest > 0) {
      segments.push({ text: remaining.substring(0, earliest), highlight: false })
    }

    segments.push({ text: earliestToken, highlight: true })
    remaining = remaining.substring(earliest + earliestToken.length)
  }

  return segments
}

export function atEnd(start: number, end: number, len: number): boolean {
  return start === end && end === len
}

function expandSelectionForTokens(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  tokens: string[],
): { start: number; end: number } | null {
  let newStart = selectionStart
  let newEnd = selectionEnd
  let expanded = false
  for (const token of tokens) {
    let idx = text.indexOf(token)
    while (idx !== -1) {
      const tokenStart = idx
      const tokenEnd = idx + token.length
      if (selectionStart < tokenEnd && selectionEnd > tokenStart) {
        if (tokenStart < newStart) {
          newStart = tokenStart
          expanded = true
        }
        if (tokenEnd > newEnd) {
          newEnd = tokenEnd
          expanded = true
        }
      }
      idx = text.indexOf(token, tokenEnd)
    }
  }
  return expanded ? { start: newStart, end: newEnd } : null
}

function tokenDeletionRangeAtOffset(
  text: string,
  cursor: number,
  tokenStart: number,
  tokenEnd: number,
  key: "Backspace" | "Delete",
): { start: number; end: number } | null {
  const trailing = text[tokenEnd] === " " ? 1 : 0
  const leading = tokenStart > 0 && text[tokenStart - 1] === " " ? 1 : 0
  const delEnd = tokenEnd + trailing
  const delStart = delEnd === text.length && leading ? tokenStart - 1 : tokenStart

  if (cursor > tokenStart && cursor < tokenEnd) {
    return { start: delStart, end: delEnd }
  }

  if (key === "Backspace" && (cursor === tokenEnd || (trailing === 1 && cursor === tokenEnd + 1))) {
    return { start: delStart, end: delEnd }
  }

  if (key === "Delete") {
    if (cursor === tokenStart) return { start: delStart, end: delEnd }
    if (leading === 1 && cursor === tokenStart - 1) return { start: tokenStart - 1, end: delEnd }
  }

  return null
}

/**
 * Find the character range [start, end) of a link notation / token to delete
 * atomically when Backspace or Delete is pressed, so partial link fragments
 * aren't left behind. Returns null if cursor/selection is not on a token.
 */
export function findTokenDeletionRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  tokens: Set<string>,
  key: "Backspace" | "Delete",
): { start: number; end: number } | null {
  if (tokens.size === 0 || text.length === 0) return null

  const allTokens = [...tokens]
    .map((p) => (p.startsWith("@") || p.startsWith("[") ? p : `@${p}`))
    .sort((a, b) => b.length - a.length)

  if (selectionStart !== selectionEnd) {
    return expandSelectionForTokens(text, selectionStart, selectionEnd, allTokens)
  }

  const cursor = selectionStart
  for (const token of allTokens) {
    let idx = text.indexOf(token)
    while (idx !== -1) {
      const match = tokenDeletionRangeAtOffset(text, cursor, idx, idx + token.length, key)
      if (match) return match
      idx = text.indexOf(token, idx + token.length)
    }
  }

  return null
}

export function insertSpacedText(
  text: string,
  value: string,
  start: number,
  end: number,
): { text: string; pos: number } {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const prefix = before && !/\s$/.test(before) ? " " : ""
  const suffix = after && !/^\s/.test(after) ? " " : ""
  const inserted = `${prefix}${value}${suffix}`
  return {
    text: `${before}${inserted}${after}`,
    pos: before.length + inserted.length,
  }
}

/**
 * Whether the input prompt should be blocked.
 *
 * Only permission requests block the prompt in the VS Code webview. Questions
 * and suggestions never block — they are dismissed automatically when a new
 * message is sent (see session.tsx sendMessage/sendCommand).
 *
 * The single-parameter signature is intentional: taking question-count would
 * structurally allow a future regression to re-couple the prompt to pending
 * questions. Keep this function at one argument.
 */
export function isPromptBlocked(permissions: number): boolean {
  return permissions > 0
}

/**
 * Whether the session is busy from the prompt's perspective.
 * Returns false (idle-like) when the session is busy only because
 * a suggestion or question tool call is pending.
 */
export function isPromptBusy(status: string, suggesting: boolean, questioning: boolean, submitting: boolean): boolean {
  return submitting || (status !== "idle" && !suggesting && !questioning)
}

/**
 * Whether the session is busy only because a suggestion is pending.
 * True when no permission request is blocking the prompt and at least one
 * suggestion is active. The `!blocked` gate keeps the Stop button available
 * when permissions block input — it does NOT mean suggestions block.
 */
export function isSuggesting(blocked: boolean, suggestions: number): boolean {
  return !blocked && suggestions > 0
}

/**
 * Whether the session is busy only because a question is pending.
 * True when no permission request is blocking the prompt and at least one
 * question is active. The `!blocked` gate keeps the Stop button available
 * when permissions block input — it does NOT mean questions block.
 */
export function isQuestioning(blocked: boolean, questions: number): boolean {
  return !blocked && questions > 0
}

/** Whether a mention token refers to a file or folder path (not a special mention like terminal/git-changes). */
export function isPathMention(text: string): boolean {
  const path = text.replace(/^@/, "")
  return path !== "terminal" && path !== "git-changes"
}

/**
 * The text that should remain in the prompt input after a memory command is
 * submitted. No-argument memory operations (e.g. rebuild, on, status, inspect)
 * typed with trailing free text (e.g. "/memory rebuild hello") keep that text in
 * the input instead of discarding it; the parser reports the unconsumed
 * remainder as `rest`. Argument-taking operations (remember, correct, forget,
 * auto, purge) consume their text, so nothing remains.
 */
export function memoryRest(cmd: ParsedMemoryCommand): string {
  return "rest" in cmd ? (cmd.rest ?? "") : ""
}
