// kilocode_change - new file
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkDocgraphStaleness, formatDocgraphStalenessWarning } from "../../../src/kilocode/mcp/docgraph-staleness-check"

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

let worktree: string

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "docgraph-staleness-"))
})

afterEach(() => {
  rmSync(worktree, { recursive: true, force: true })
})

function citationPart(relPath: string, contentSha256: string): string {
  return JSON.stringify({
    document: { rel_path: relPath, content_sha256: contentSha256, title: "irrelevant" },
  })
}

describe("checkDocgraphStaleness", () => {
  test("does nothing for a non-docgraph MCP server", () => {
    writeFileSync(join(worktree, "a.ts"), "hello")
    const result = checkDocgraphStaleness({
      clientName: "some-other-server",
      worktree,
      textParts: [citationPart("a.ts", "deadbeef")],
    })
    expect(result).toEqual([])
  })

  test("reports nothing when the local file matches the indexed hash", () => {
    const content = "export const x = 1\n"
    writeFileSync(join(worktree, "a.ts"), content)
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: [citationPart("a.ts", sha256(content))],
    })
    expect(result).toEqual([])
  })

  test("reports 'modified' when the local file content differs from the indexed hash", () => {
    writeFileSync(join(worktree, "a.ts"), "export const x = 2\n")
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: [citationPart("a.ts", sha256("export const x = 1\n"))],
    })
    expect(result).toEqual([{ relPath: "a.ts", status: "modified" }])
  })

  test("reports 'deleted' when the cited file no longer exists locally", () => {
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: [citationPart("gone.ts", "deadbeef")],
    })
    expect(result).toEqual([{ relPath: "gone.ts", status: "deleted" }])
  })

  test("skips a rel_path that escapes the worktree", () => {
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: [citationPart("../../etc/passwd", "deadbeef")],
    })
    expect(result).toEqual([])
  })

  test("finds citations nested inside arrays and nested objects", () => {
    writeFileSync(join(worktree, "b.ts"), "changed")
    const nested = JSON.stringify({
      matches: [{ provenance: { rel_path: "b.ts", content_sha256: sha256("original") } }],
    })
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: [nested],
    })
    expect(result).toEqual([{ relPath: "b.ts", status: "modified" }])
  })

  test("dedupes repeated citations of the same rel_path", () => {
    writeFileSync(join(worktree, "c.ts"), "changed")
    const hash = sha256("original")
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: [citationPart("c.ts", hash), citationPart("c.ts", hash)],
    })
    expect(result).toEqual([{ relPath: "c.ts", status: "modified" }])
  })

  test("ignores text parts that are not valid JSON", () => {
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: ["not json at all"],
    })
    expect(result).toEqual([])
  })

  test("resolves citations under a nested rel_path", () => {
    mkdirSync(join(worktree, "src", "app"), { recursive: true })
    const content = "value"
    writeFileSync(join(worktree, "src", "app", "d.ts"), content)
    const result = checkDocgraphStaleness({
      clientName: "docgraph",
      worktree,
      textParts: [citationPart("src/app/d.ts", sha256(content))],
    })
    expect(result).toEqual([])
  })
})

describe("formatDocgraphStalenessWarning", () => {
  test("returns undefined when there is nothing stale", () => {
    expect(formatDocgraphStalenessWarning([])).toBeUndefined()
  })

  test("formats a banner naming each stale file and reason", () => {
    const warning = formatDocgraphStalenessWarning([
      { relPath: "a.ts", status: "modified" },
      { relPath: "b.ts", status: "deleted" },
    ])
    expect(warning).toContain("<stale_graph_content>")
    expect(warning).toContain("a.ts — local content differs from the indexed version")
    expect(warning).toContain("b.ts — file not found locally (deleted or moved since last ingest)")
    expect(warning).toContain("</stale_graph_content>")
  })
})
