export interface ExtractedCodeContext {
  type?: "code-context"
  path: string
  startLine?: number
  endLine?: number
  code: string
}
export interface ExtractedBrowserElement {
  type: "browser-element"
  selector: string
  url?: string
  outerHTML?: string
  css?: string
  label: string
}
export type MessageSegment =
  | { type: "text"; text: string }
  | (ExtractedCodeContext & { type: "code-context" })
  | ExtractedBrowserElement

const PATTERN =
  /^\s*(?:(?:Explain|Fix(?: any issues in)?|Improve)\s+the following code from file path\s+)?([^\r\n:`]+?)(?::(?:L)?(\d+)(?:-(?:L)?(\d+))?)?\r?\n```[^\r\n]*\r?\n([\s\S]*?)\r?\n```(?:\r?\n)*/i

const isLikelyPath = (p: string) => /[\/\\]/.test(p) || /\.[a-zA-Z0-9_-]+$/.test(p)

export function parseCodeContexts(raw: string): {
  contexts: ExtractedCodeContext[]
  remaining: string
} {
  const contexts: ExtractedCodeContext[] = []
  let remaining = raw

  while (true) {
    const match = remaining.match(PATTERN)
    if (!match) break
    const [full, rawPath, start, end, code] = match
    const path = rawPath?.trim()
    if (!path || path.includes("```")) break
    if (!start && !isLikelyPath(path)) break

    contexts.push({
      path,
      startLine: start ? parseInt(start, 10) : undefined,
      endLine: end ? parseInt(end, 10) : start ? parseInt(start, 10) : undefined,
      code,
    })
    remaining = remaining.slice(full.length)
  }

  return { contexts, remaining: remaining.trimStart() }
}

const CODE_CONTEXT_GLOBAL =
  /(?:^|\r?\n)(?:(?:Explain|Fix(?: any issues in)?|Improve)\s+the following code from file path\s+)?([^\r\n:`<>]+?)(?::(?:L)?(\d+)(?:-(?:L)?(\d+))?)?\r?\n```[^\r\n]*\r?\n((?:(?!```)[\s\S])*?)\r?\n```/gi

const BROWSER_ELEMENT_GLOBAL =
  /Attached Element Context from Browser Preview(?:\r?\n)+(?:Element:\s*([^\r\n]+)(?:\r?\n)+)?(?:URL:\s*([^\r\n]+)(?:\r?\n)+)?Outer HTML:(?:\r?\n)+```[^\r\n]*\r?\n([\s\S]*?)\r?\n```(?:\s*Dimensions:(?:\r?\n)+(?:-\s*[^\r\n]+(?:\r?\n)*)+)?(?:\s*CSS:(?:\r?\n)+```css\r?\n([\s\S]*?)\r?\n```)?/gi

const BRACKET_FILE_GLOBAL = /\[file:([^\r\n:]+?)(?::(\d+)(?:-(\d+))?)?\]/g
const BRACKET_EL_GLOBAL = /\[el:([^\r\n\]]+)\]/g

type MatchRange = {
  start: number
  end: number
  segment: (ExtractedCodeContext & { type: "code-context" }) | ExtractedBrowserElement
}

export function parseMessageSegments(raw: string): MessageSegment[] {
  if (!raw) return []

  const matches: MatchRange[] = []

  // 1. Match full browser element blocks first (strict header signature)
  for (const m of raw.matchAll(BROWSER_ELEMENT_GLOBAL)) {
    const [full, rawElement, url, outerHTML, css] = m
    if (m.index === undefined) continue
    const selector = rawElement?.trim() ?? "element"
    const label = selector.split(">").pop()?.trim() || selector

    matches.push({
      start: m.index,
      end: m.index + full.length,
      segment: {
        type: "browser-element",
        selector,
        label,
        url: url?.trim(),
        outerHTML,
        css,
      },
    })
  }

  // 2. Match full code context blocks (skipping any ranges inside browser element blocks)
  for (const m of raw.matchAll(CODE_CONTEXT_GLOBAL)) {
    const [full, rawPath, start, end, code] = m
    const path = rawPath?.trim()
    if (!path || path.includes("```") || path.includes("<") || path.includes(">")) continue
    if (!start && !isLikelyPath(path)) continue
    if (m.index === undefined) continue
    if (matches.some((existing) => m.index! < existing.end && m.index! + full.length > existing.start)) continue

    matches.push({
      start: m.index,
      end: m.index + full.length,
      segment: {
        type: "code-context",
        path,
        startLine: start ? parseInt(start, 10) : undefined,
        endLine: end ? parseInt(end, 10) : start ? parseInt(start, 10) : undefined,
        code,
      },
    })
  }

  // 3. Match bracketed tokens [file:...]
  for (const m of raw.matchAll(BRACKET_FILE_GLOBAL)) {
    const [full, path, start, end] = m
    if (m.index === undefined) continue
    if (matches.some((existing) => m.index! >= existing.start && m.index! < existing.end)) continue

    matches.push({
      start: m.index,
      end: m.index + full.length,
      segment: {
        type: "code-context",
        path: path.trim(),
        startLine: start ? parseInt(start, 10) : undefined,
        endLine: end ? parseInt(end, 10) : start ? parseInt(start, 10) : undefined,
        code: "",
      },
    })
  }

  // 4. Match bracketed tokens [el:...]
  for (const m of raw.matchAll(BRACKET_EL_GLOBAL)) {
    const [full, label] = m
    if (m.index === undefined) continue
    if (matches.some((existing) => m.index! >= existing.start && m.index! < existing.end)) continue

    matches.push({
      start: m.index,
      end: m.index + full.length,
      segment: {
        type: "browser-element",
        selector: label.trim(),
        label: label.trim(),
      },
    })
  }

  if (matches.length === 0) {
    return [{ type: "text", text: raw }]
  }

  matches.sort((a, b) => a.start - b.start)

  const segments: MessageSegment[] = []
  let cursor = 0

  for (const match of matches) {
    if (match.start > cursor) {
      const text = raw.slice(cursor, match.start).replace(/^\n+|\n+$/g, "")
      if (text) {
        segments.push({ type: "text", text })
      }
    }
    segments.push(match.segment)
    cursor = match.end
  }

  if (cursor < raw.length) {
    const text = raw.slice(cursor).replace(/^\n+|\n+$/g, "")
    if (text) {
      segments.push({ type: "text", text })
    }
  }

  return segments.length > 0 ? segments : [{ type: "text", text: raw }]
}
