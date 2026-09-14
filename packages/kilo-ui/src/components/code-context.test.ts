import { describe, expect, it } from "bun:test"
import { parseCodeContexts, parseMessageSegments } from "./code-context"

describe("parseCodeContexts", () => {
  it("extracts single code context block and returns remaining prompt text", () => {
    const raw = "src/foo.ts:11-22\n```\nconst a = 1\n```\n\nHow do I refactor this?"
    const result = parseCodeContexts(raw)

    expect(result.contexts).toEqual([
      {
        path: "src/foo.ts",
        startLine: 11,
        endLine: 22,
        code: "const a = 1",
      },
    ])
    expect(result.remaining).toBe("How do I refactor this?")
  })

  it("extracts multiple code context blocks", () => {
    const raw = "file1.ts:1-5\n```\nline 1\nline 2\n```\n\nfile2.ts:10-20\n```\nline 10\n```\n\nCompare these"
    const result = parseCodeContexts(raw)

    expect(result.contexts).toEqual([
      {
        path: "file1.ts",
        startLine: 1,
        endLine: 5,
        code: "line 1\nline 2",
      },
      {
        path: "file2.ts",
        startLine: 10,
        endLine: 20,
        code: "line 10",
      },
    ])
    expect(result.remaining).toBe("Compare these")
  })

  it("handles code context without trailing user message", () => {
    const raw = "src/bar.ts:5-10\n```\nreturn null\n```"
    const result = parseCodeContexts(raw)

    expect(result.contexts).toEqual([
      {
        path: "src/bar.ts",
        startLine: 5,
        endLine: 10,
        code: "return null",
      },
    ])
    expect(result.remaining).toBe("")
  })

  it("leaves normal message untouched when no code context prefix is present", () => {
    const raw = "Here is some code:\n```ts\nconst x = 1\n```"
    const result = parseCodeContexts(raw)

    expect(result.contexts).toEqual([])
    expect(result.remaining).toBe(raw)
  })

  it("handles CRLF line endings", () => {
    const raw = "src/win.ts:1-3\r\n```\r\nconst w = true\r\n```\r\n\r\nFix this"
    const result = parseCodeContexts(raw)

    expect(result.contexts).toEqual([
      {
        path: "src/win.ts",
        startLine: 1,
        endLine: 3,
        code: "const w = true",
      },
    ])
    expect(result.remaining).toBe("Fix this")
  })

  it("handles single line and whole file without line numbers", () => {
    const raw = "src/single.ts:5\n```\nconst a = 1\n```\n\nsrc/whole.ts\n```\nconst b = 2\n```\n\nDone"
    const result = parseCodeContexts(raw)

    expect(result.contexts).toEqual([
      {
        path: "src/single.ts",
        startLine: 5,
        endLine: 5,
        code: "const a = 1",
      },
      {
        path: "src/whole.ts",
        startLine: undefined,
        endLine: undefined,
        code: "const b = 2",
      },
    ])
    expect(result.remaining).toBe("Done")
  })

  it("handles explain code template format", () => {
    const raw =
      "Explain the following code from file path packages/opencode/src/session/processor.ts:1-10\n```ts\nimport { Bus } from '../bus'\n```\n\ncan you explain this file?"
    const result = parseCodeContexts(raw)

    expect(result.contexts).toEqual([
      {
        path: "packages/opencode/src/session/processor.ts",
        startLine: 1,
        endLine: 10,
        code: "import { Bus } from '../bus'",
      },
    ])
    expect(result.remaining).toBe("can you explain this file?")
  })
})

describe("parseMessageSegments", () => {
  it("returns single text segment for plain message", () => {
    const raw = "How do I implement a binary search?"
    const result = parseMessageSegments(raw)
    expect(result).toEqual([{ type: "text", text: "How do I implement a binary search?" }])
  })

  it("extracts inline code context segment in the middle of text", () => {
    const raw = "Look at this\n\nsrc/foo.ts:10-20\n```\nconst x = 1\n```\n\nand fix the bug"
    const result = parseMessageSegments(raw)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ type: "text", text: "Look at this" })
    expect(result[1]).toEqual({
      type: "code-context",
      path: "src/foo.ts",
      startLine: 10,
      endLine: 20,
      code: "const x = 1",
    })
    expect(result[2]).toEqual({ type: "text", text: "and fix the bug" })
  })

  it("extracts browser element context in the middle of text", () => {
    const raw =
      "Check this\n\nAttached Element Context from Browser Preview\n\nElement: img.floating_element\nURL: http://localhost:8080/\nOuter HTML:\n```html\n<img src='logo.png'>\n```\n\nand align it"
    const result = parseMessageSegments(raw)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ type: "text", text: "Check this" })
    expect(result[1]).toEqual({
      type: "browser-element",
      selector: "img.floating_element",
      label: "img.floating_element",
      url: "http://localhost:8080/",
      outerHTML: "<img src='logo.png'>",
      css: undefined,
    })
    expect(result[2]).toEqual({ type: "text", text: "and align it" })
  })

  it("extracts multiple mixed context segments in order", () => {
    const raw =
      "Compare\n\nAttached Element Context from Browser Preview\n\nElement: div.sidebar > span.label\nURL: http://localhost:3000\nOuter HTML:\n```html\n<span>Hi</span>\n```\n\nwith\n\nsrc/App.tsx:5-15\n```\nconst a = 2\n```\n\ncarefully"
    const result = parseMessageSegments(raw)

    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ type: "text", text: "Compare" })
    expect(result[1]).toEqual({
      type: "browser-element",
      selector: "div.sidebar > span.label",
      label: "span.label",
      url: "http://localhost:3000",
      outerHTML: "<span>Hi</span>",
      css: undefined,
    })
    expect(result[2]).toEqual({ type: "text", text: "with" })
    expect(result[3]).toEqual({
      type: "code-context",
      path: "src/App.tsx",
      startLine: 5,
      endLine: 15,
      code: "const a = 2",
    })
    expect(result[4]).toEqual({ type: "text", text: "carefully" })
  })

  it("extracts bracketed tokens [file:...] and [el:...]", () => {
    const raw = "Fix [file:PromptInput.tsx:10-20] and [el:img.logo]"
    const result = parseMessageSegments(raw)

    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ type: "text", text: "Fix " })
    expect(result[1]).toEqual({
      type: "code-context",
      path: "PromptInput.tsx",
      startLine: 10,
      endLine: 20,
      code: "",
    })
    expect(result[2]).toEqual({ type: "text", text: " and " })
    expect(result[3]).toEqual({
      type: "browser-element",
      selector: "img.logo",
      label: "img.logo",
    })
  })

  it("extracts real browser preview element citation with multiline outerHTML and full CSS", () => {
    const raw = `Attached Element Context from Browser Preview

Element: html > body > div.main_page > div.content_section.floating_element > div.content_section_text > p

URL: http://localhost/

Outer HTML:
\`\`\`html
<p>
  This is the default welcome page
</p>
\`\`\`

Dimensions:
- top: 195px
- left: 19px
- width: 778px
- height: 65px

CSS:
\`\`\`css
display: block;
position: static;
width: 778px;
height: 64.8px;
\`\`\``
    const result = parseMessageSegments(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: "browser-element",
      selector: "html > body > div.main_page > div.content_section.floating_element > div.content_section_text > p",
      label: "p",
      url: "http://localhost/",
      outerHTML: "<p>\n  This is the default welcome page\n</p>",
      css: "display: block;\nposition: static;\nwidth: 778px;\nheight: 64.8px;",
    })
  })
})
