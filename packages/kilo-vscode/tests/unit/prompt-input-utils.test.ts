import { describe, it, expect } from "bun:test"
import {
  fileName,
  dirName,
  buildHighlightSegments,
  atEnd,
  insertSpacedText,
  findTokenDeletionRange,
  isPromptBlocked,
  isPromptBusy,
  isSuggesting,
  isQuestioning,
  isPathMention,
  isInlineContextToken,
  codeContextToken,
  browserElementToken,
  formatCodeContext,
  buildPromptMessage,
  applySandboxState,
  applySandboxStates,
  memoryRest,
} from "../../webview-ui/src/components/chat/prompt-input-utils"
import { parseMemoryCommand } from "../../webview-ui/src/utils/memory-command"

describe("applySandboxState", () => {
  const state = (enabled: boolean, revision: number, sessionID = "ses_1", directory = "/repo") => ({
    sessionID,
    directory,
    enabled,
    available: true,
    version: enabled ? 1 : 0,
    revision,
  })

  it("ignores an HTTP response with an older backend version", () => {
    const latest = { ...state(true, 1), version: 2 }
    const stale = { ...state(false, 2), version: 1 }
    expect(applySandboxState(latest, stale)).toEqual(latest)
  })

  it("uses provider revision to order equal backend versions", () => {
    const current = { ...state(false, 2), version: 4 }
    const older = { ...state(true, 1), version: 4 }
    const newer = { ...state(true, 3), version: 4 }
    expect(applySandboxState(current, older)).toEqual(current)
    expect(applySandboxState(current, newer)).toEqual(newer)
  })

  it("keeps global provider ordering across sessions and directories", () => {
    expect(applySandboxState(state(true, 5, "ses_1"), state(false, 1, "ses_2"))).toEqual(state(true, 5, "ses_1"))
    expect(applySandboxState(state(true, 5), state(false, 6, "ses_1", "/worktree"))).toEqual(
      state(false, 6, "ses_1", "/worktree"),
    )
  })

  it("caches independently ordered statuses for worktree switching", () => {
    const first = applySandboxStates({}, state(true, 5, "ses_1"))
    const second = applySandboxStates(first, state(false, 1, "ses_2"))

    expect(second).toEqual({
      ses_1: state(true, 5, "ses_1"),
      ses_2: state(false, 1, "ses_2"),
    })
    expect(applySandboxStates(second, state(false, 4, "ses_1"))).toBe(second)
  })
})

describe("fileName", () => {
  it("extracts the last segment of a unix path", () => {
    expect(fileName("src/components/chat/PromptInput.tsx")).toBe("PromptInput.tsx")
  })

  it("extracts the last segment of a Windows path", () => {
    expect(fileName("src\\components\\chat\\PromptInput.tsx")).toBe("PromptInput.tsx")
  })

  it("returns the path itself when no separator present", () => {
    expect(fileName("README.md")).toBe("README.md")
  })

  it("returns the filename for a single directory segment", () => {
    expect(fileName("src/foo.ts")).toBe("foo.ts")
  })

  it("handles mixed separators", () => {
    expect(fileName("src\\components/chat/File.tsx")).toBe("File.tsx")
  })
})

describe("dirName", () => {
  it("returns empty string for a file with no directory", () => {
    expect(dirName("README.md")).toBe("")
  })

  it("returns the directory for a simple path", () => {
    expect(dirName("src/foo.ts")).toBe("src")
  })

  it("returns full directory for a short path", () => {
    expect(dirName("src/components/foo.ts")).toBe("src/components")
  })

  it("truncates long directories to last two segments", () => {
    const path = "packages/kilo-vscode/webview-ui/src/components/chat/foo.ts"
    const result = dirName(path)
    expect(result).toMatch(/^…\//)
    expect(result).toContain("components/chat")
  })

  it("does not truncate directories at exactly 30 chars", () => {
    const dir = "a".repeat(15) + "/" + "b".repeat(14)
    const result = dirName(`${dir}/file.ts`)
    expect(result).toBe(dir)
  })

  it("truncates directories longer than 30 chars", () => {
    const dir = "a".repeat(16) + "/" + "b".repeat(15)
    const result = dirName(`${dir}/file.ts`)
    expect(result.startsWith("…/")).toBe(true)
  })

  it("normalizes Windows backslashes before measuring length", () => {
    const result = dirName("src\\foo.ts")
    expect(result).toBe("src")
  })
})

describe("buildHighlightSegments", () => {
  it("returns single non-highlighted segment when paths set is empty", () => {
    const result = buildHighlightSegments("hello world", new Set())
    expect(result).toEqual([{ text: "hello world", highlight: false }])
  })

  it("returns single non-highlighted segment when no mention present", () => {
    const result = buildHighlightSegments("hello world", new Set(["foo.ts"]))
    expect(result).toEqual([{ text: "hello world", highlight: false }])
  })

  it("highlights a single mention token", () => {
    const result = buildHighlightSegments("@foo.ts", new Set(["foo.ts"]))
    expect(result).toEqual([{ text: "@foo.ts", highlight: true }])
  })

  it("splits text before and highlight token", () => {
    const result = buildHighlightSegments("see @foo.ts here", new Set(["foo.ts"]))
    expect(result).toEqual([
      { text: "see ", highlight: false },
      { text: "@foo.ts", highlight: true },
      { text: " here", highlight: false },
    ])
  })

  it("highlights multiple mentions in order", () => {
    const result = buildHighlightSegments("@a.ts and @b.ts done", new Set(["a.ts", "b.ts"]))
    expect(result).toEqual([
      { text: "@a.ts", highlight: true },
      { text: " and ", highlight: false },
      { text: "@b.ts", highlight: true },
      { text: " done", highlight: false },
    ])
  })

  it("picks the earliest mention when multiple paths could match", () => {
    const result = buildHighlightSegments("@b.ts then @a.ts", new Set(["a.ts", "b.ts"]))
    expect(result[0]).toEqual({ text: "@b.ts", highlight: true })
    expect(result[2]).toEqual({ text: "@a.ts", highlight: true })
  })

  it("handles back-to-back mentions with no separator", () => {
    const result = buildHighlightSegments("@a.ts@b.ts", new Set(["a.ts", "b.ts"]))
    const highlighted = result.filter((s) => s.highlight)
    expect(highlighted).toHaveLength(2)
  })

  it("returns empty array for empty string", () => {
    const result = buildHighlightSegments("", new Set(["foo.ts"]))
    expect(result).toEqual([])
  })

  it("does not partially match longer paths", () => {
    const result = buildHighlightSegments("@foo.ts", new Set(["foo.tsx"]))
    expect(result).toEqual([{ text: "@foo.ts", highlight: false }])
  })
})

describe("atEnd", () => {
  it("returns true when caret is at end with no selection", () => {
    expect(atEnd(5, 5, 5)).toBe(true)
  })

  it("returns false when caret is before end", () => {
    expect(atEnd(4, 4, 5)).toBe(false)
  })

  it("returns false when there is a selection", () => {
    expect(atEnd(2, 5, 5)).toBe(false)
  })

  it("returns true for empty input", () => {
    expect(atEnd(0, 0, 0)).toBe(true)
  })

  it("returns false when caret is at start of non-empty input", () => {
    expect(atEnd(0, 0, 10)).toBe(false)
  })
})

describe("isPromptBlocked", () => {
  it("returns false when zero permissions", () => {
    expect(isPromptBlocked(0)).toBe(false)
  })

  it("returns true when permissions exist", () => {
    expect(isPromptBlocked(1)).toBe(true)
    expect(isPromptBlocked(3)).toBe(true)
  })

  it("accepts exactly one argument (locks the API against regression)", () => {
    // Prevents a future change from reintroducing the question/blocking coupling.
    // See prompt-send-contract.test.ts for the source-level complement.
    expect(isPromptBlocked.length).toBe(1)
  })
})

describe("isPromptBusy", () => {
  it("returns true when busy and neither suggesting nor questioning", () => {
    expect(isPromptBusy("busy", false, false, false)).toBe(true)
  })

  it("returns true while submitting before the backend reports busy", () => {
    expect(isPromptBusy("idle", false, false, true)).toBe(true)
  })

  it("returns false when idle regardless of suggesting/questioning", () => {
    expect(isPromptBusy("idle", false, false, false)).toBe(false)
    expect(isPromptBusy("idle", true, false, false)).toBe(false)
    expect(isPromptBusy("idle", false, true, false)).toBe(false)
    expect(isPromptBusy("idle", true, true, false)).toBe(false)
  })

  it("returns false when busy but suggesting is true (suggestion decoupling)", () => {
    expect(isPromptBusy("busy", true, false, false)).toBe(false)
  })

  it("returns false when busy but questioning is true (question decoupling)", () => {
    expect(isPromptBusy("busy", false, true, false)).toBe(false)
  })

  it("returns false when busy and both suggesting and questioning", () => {
    expect(isPromptBusy("busy", true, true, false)).toBe(false)
  })

  it("returns true for non-idle non-busy status when not suggesting/questioning", () => {
    expect(isPromptBusy("retry", false, false, false)).toBe(true)
  })
})

describe("insertSpacedText", () => {
  it("inserts transcript into empty text", () => {
    expect(insertSpacedText("", "hello", 0, 0)).toEqual({ text: "hello", pos: 5 })
  })

  it("adds spaces between surrounding words", () => {
    expect(insertSpacedText("helloworld", "beautiful", 5, 5)).toEqual({ text: "hello beautiful world", pos: 16 })
  })

  it("does not duplicate existing spaces", () => {
    expect(insertSpacedText("hello world", "beautiful", 6, 6)).toEqual({ text: "hello beautiful world", pos: 16 })
  })

  it("replaces selected text and keeps caret after transcript", () => {
    expect(insertSpacedText("hello bad world", "beautiful", 6, 9)).toEqual({ text: "hello beautiful world", pos: 15 })
  })

  it("preserves leading and trailing insertion positions", () => {
    expect(insertSpacedText("world", "hello", 0, 0)).toEqual({ text: "hello world", pos: 6 })
    expect(insertSpacedText("hello", "world", 5, 5)).toEqual({ text: "hello world", pos: 11 })
  })
})

describe("isSuggesting", () => {
  it("returns true when not blocked and suggestions > 0", () => {
    expect(isSuggesting(false, 1)).toBe(true)
    expect(isSuggesting(false, 3)).toBe(true)
  })

  it("returns false when blocked even with suggestions", () => {
    expect(isSuggesting(true, 2)).toBe(false)
  })

  it("returns false when not blocked but no suggestions", () => {
    expect(isSuggesting(false, 0)).toBe(false)
  })
})

describe("isQuestioning", () => {
  it("returns true when not blocked and questions > 0", () => {
    expect(isQuestioning(false, 1)).toBe(true)
    expect(isQuestioning(false, 5)).toBe(true)
  })

  it("returns false when blocked even with questions", () => {
    expect(isQuestioning(true, 2)).toBe(false)
  })

  it("returns false when not blocked but no questions", () => {
    expect(isQuestioning(false, 0)).toBe(false)
  })
})

describe("isPathMention", () => {
  it("returns true for a file path", () => {
    expect(isPathMention("@src/foo.ts")).toBe(true)
  })

  it("returns true for a simple filename", () => {
    expect(isPathMention("@README.md")).toBe(true)
  })

  it("returns true for a folder path with trailing slash", () => {
    expect(isPathMention("@src/components/")).toBe(true)
  })

  it("returns true for a folder path without trailing slash", () => {
    expect(isPathMention("@src/components")).toBe(true)
  })

  it("returns false for terminal mention", () => {
    expect(isPathMention("@terminal")).toBe(false)
  })

  it("returns false for git-changes mention", () => {
    expect(isPathMention("@git-changes")).toBe(false)
  })

  it("handles text without @ prefix", () => {
    expect(isPathMention("src/foo.ts")).toBe(true)
  })
})

describe("memoryRest", () => {
  it("keeps trailing text in the input after a no-argument memory command", () => {
    // /memory rebuild hello -> rebuild executes, "hello" stays in the input.
    // This is the submit-path half of the trailing-text bug: handleSend sets
    // the input to memoryRest(parsed), so a regression would drop "hello".
    const memory = parseMemoryCommand("/memory rebuild hello")
    expect(memory).not.toBeUndefined()
    expect(memoryRest(memory!)).toBe("hello")
  })

  it("keeps trailing text through the project scope", () => {
    expect(memoryRest(parseMemoryCommand("/memory project rebuild hello")!)).toBe("hello")
  })

  it("returns empty string when a no-argument command has no trailing text", () => {
    expect(memoryRest(parseMemoryCommand("/memory rebuild")!)).toBe("")
  })

  it("keeps trailing text in the input after the show command", () => {
    // /memory show draft notes -> show executes, "draft notes" stays in the input.
    expect(memoryRest(parseMemoryCommand("/memory show draft notes")!)).toBe("draft notes")
  })

  it("returns empty string for argument-taking operations", () => {
    // remember/correct/forget/auto/purge consume their text, so nothing remains.
    expect(memoryRest(parseMemoryCommand("/memory remember hello")!)).toBe("")
    expect(memoryRest(parseMemoryCommand("/memory auto on")!)).toBe("")
  })
})

describe("codeContextToken & browserElementToken", () => {
  it("formats code context token with line range", () => {
    const token = codeContextToken({
      id: "1",
      path: "src/components/chat/PromptInput.tsx",
      startLine: 10,
      endLine: 20,
      text: "code",
    })
    expect(token).toBe("[file:PromptInput.tsx:10-20]")
  })

  it("formats code context token with single line", () => {
    const token = codeContextToken({
      id: "1",
      path: "src/foo.ts",
      startLine: 42,
      endLine: 42,
      text: "code",
    })
    expect(token).toBe("[file:foo.ts:42]")
  })

  it("formats browser element token", () => {
    const token = browserElementToken({
      id: "1",
      label: "img.floating_element",
      text: "Attached Element...",
    })
    expect(token).toBe("[el:img.floating_element]")
  })

  it("identifies inline context tokens", () => {
    expect(isInlineContextToken("[file:PromptInput.tsx:10-20]")).toBe(true)
    expect(isInlineContextToken("[el:img.floating_element]")).toBe(true)
    expect(isInlineContextToken("@src/foo.ts")).toBe(false)
    expect(isInlineContextToken("normal text")).toBe(false)
  })
})

describe("formatCodeContext", () => {
  it("formats code context block with path, line range, and fenced code", () => {
    const formatted = formatCodeContext({
      id: "1",
      path: "src/foo.ts",
      startLine: 5,
      endLine: 10,
      text: "const a = 1",
    })
    expect(formatted).toBe("src/foo.ts:5-10\n```\nconst a = 1\n```")
  })
})

describe("buildPromptMessage with inline tokens", () => {
  const codeItem = {
    id: "1",
    path: "src/App.tsx",
    startLine: 10,
    endLine: 20,
    text: "const a = 1",
  }
  const elItem = {
    id: "2",
    label: "img.floating_element",
    text: "Attached Element Context from Browser Preview\nElement: img.floating_element",
  }

  it("expands code context and element tokens in-place in the middle of text", () => {
    const draft = "Please check [el:img.floating_element] and compare with [file:App.tsx:10-20] carefully."
    const result = buildPromptMessage(draft, [codeItem], "", [elItem])
    expect(result).toContain("Please check \n\nAttached Element Context")
    expect(result).toContain("and compare with \n\nsrc/App.tsx:10-20\n```\nconst a = 1\n```\n\n carefully.")
  })

  it("expands a single inline token to its trimmed content", () => {
    const draft = "[el:img.floating_element]"
    const result = buildPromptMessage(draft, [], "", [elItem])
    expect(result).toBe("Attached Element Context from Browser Preview\nElement: img.floating_element")
  })

  it("omits tokens that were deleted from the draft", () => {
    const draft = "Only text here"
    const result = buildPromptMessage(draft, [codeItem], "", [elItem])
    expect(result).toBe("Only text here")
  })

  it("combines in-place expanded tokens with review markdown prefix", () => {
    const draft = "Fix [el:img.floating_element]"
    const review = "Review comments:\n- Fix this"
    const result = buildPromptMessage(draft, [], review, [elItem])
    expect(result.startsWith("Review comments:\n- Fix this\n\nFix")).toBe(true)
  })
})

describe("buildHighlightSegments with inline tokens", () => {
  it("highlights bracketed context tokens in the middle of text", () => {
    const text = "Check [el:img.floating_element] and @foo.ts now"
    const paths = new Set(["foo.ts", "[el:img.floating_element]"])
    const result = buildHighlightSegments(text, paths)
    expect(result).toEqual([
      { text: "Check ", highlight: false },
      { text: "[el:img.floating_element]", highlight: true },
      { text: " and ", highlight: false },
      { text: "@foo.ts", highlight: true },
      { text: " now", highlight: false },
    ])
  })
})

describe("findTokenDeletionRange", () => {
  const tokens = new Set(["src/foo.ts", "[file:App.tsx:1-10]", "[el:img.floating_element]"])

  describe("bracketed context tokens [file:...] and [el:...]", () => {
    it("deletes entire token when Backspace is pressed at end of token", () => {
      const text = "check [file:App.tsx:1-10] now"
      const cursor = 25 // right at ']'
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Backspace")
      expect(range).toEqual({ start: 6, end: 26 })
      expect(text.slice(range!.start, range!.end)).toBe("[file:App.tsx:1-10] ")
    })

    it("deletes entire token when Backspace is pressed on space after token", () => {
      const text = "check [file:App.tsx:1-10] now"
      const cursor = 26 // after space
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Backspace")
      expect(range).toEqual({ start: 6, end: 26 })
    })

    it("deletes entire token when Backspace is pressed inside token", () => {
      const text = "check [file:App.tsx:1-10] now"
      const cursor = 15 // inside "App.tsx"
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Backspace")
      expect(range).toEqual({ start: 6, end: 26 })
    })

    it("deletes entire token when Delete is pressed at start of token", () => {
      const text = "check [el:img.floating_element] now"
      const cursor = 6 // right before '['
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Delete")
      expect(range).toEqual({ start: 6, end: 32 })
      expect(text.slice(range!.start, range!.end)).toBe("[el:img.floating_element] ")
    })

    it("deletes entire token when Delete is pressed inside token", () => {
      const text = "check [el:img.floating_element] now"
      const cursor = 15 // inside "img"
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Delete")
      expect(range).toEqual({ start: 6, end: 32 })
    })

    it("cleans leading space when deleting token at end of text", () => {
      const text = "look at [el:img.floating_element]"
      const cursor = text.length
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Backspace")
      expect(range).toEqual({ start: 7, end: 33 })
      expect(text.slice(range!.start, range!.end)).toBe(" [el:img.floating_element]")
    })
  })

  describe("@mentions", () => {
    it("deletes entire mention when Backspace is pressed at end", () => {
      const text = "see @src/foo.ts here"
      const cursor = 15 // after "ts"
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Backspace")
      expect(range).toEqual({ start: 4, end: 16 })
      expect(text.slice(range!.start, range!.end)).toBe("@src/foo.ts ")
    })

    it("deletes entire mention when Backspace is pressed inside mention", () => {
      const text = "see @src/foo.ts here"
      const cursor = 8 // inside "@src/foo"
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Backspace")
      expect(range).toEqual({ start: 4, end: 16 })
    })

    it("deletes entire mention when Delete is pressed at start", () => {
      const text = "see @src/foo.ts here"
      const cursor = 4 // at '@'
      const range = findTokenDeletionRange(text, cursor, cursor, tokens, "Delete")
      expect(range).toEqual({ start: 4, end: 16 })
    })
  })

  describe("selection expansion", () => {
    it("expands selection to entire token when selection overlaps token partially", () => {
      const text = "check [file:App.tsx:1-10] now"
      // User selected "App.tsx" (index 12 to 19)
      const range = findTokenDeletionRange(text, 12, 19, tokens, "Backspace")
      expect(range).toEqual({ start: 6, end: 25 })
    })
  })

  describe("normal text", () => {
    it("returns null when cursor is on normal text with no token", () => {
      const text = "hello world"
      expect(findTokenDeletionRange(text, 5, 5, tokens, "Backspace")).toBeNull()
      expect(findTokenDeletionRange(text, 0, 0, tokens, "Delete")).toBeNull()
    })

    it("returns null when token set is empty", () => {
      const text = "[file:App.tsx:1-10]"
      expect(findTokenDeletionRange(text, 5, 5, new Set(), "Backspace")).toBeNull()
    })
  })
})
