// kilocode_change - new file
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { MemoryPaths } from "@kilocode/kilo-memory/paths"
import { IdeMemoryForwarder } from "../../../src/kilocode/telemetry/ide-memory-forwarder"
import type { MemoryEvents } from "../../../src/kilocode/memory/events"

function savedEvent(directory: string, files: string[]): MemoryEvents.Status {
  return {
    directory,
    enabled: true,
    state: "updating",
    project: { bytes: 0, estimatedTokens: 0, truncated: false },
    detail: { type: "saved", message: "Memory saved", files },
  }
}

function writeCorrections(dataDir: string, directory: string, text: string) {
  const root = MemoryPaths.root({ ctx: { directory, worktree: "/" }, data: dataDir })
  mkdirSync(root, { recursive: true })
  writeFileSync(MemoryPaths.files(root).corrections, text)
}

describe("IdeMemoryForwarder.handle", () => {
  test("forwards each corrections.md entry as a propose_memory tool call", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ide-memory-data-"))
    const directory = mkdtempSync(path.join(tmpdir(), "ide-memory-project-"))
    writeCorrections(
      dataDir,
      directory,
      "## Decisions\n- retry-policy :: Always retry MCP calls up to 3 times\n- auth-flow :: Use device code flow for CLI login\n",
    )
    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const client: IdeMemoryForwarder.McpToolClient = {
      callTool: async (params) => {
        calls.push(params)
        return { isError: false }
      },
    }

    await IdeMemoryForwarder.handle(savedEvent(directory, ["corrections.md"]), {
      client,
      graphID: "graph-123",
      dataDir,
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      name: "propose_memory",
      arguments: { graph_id: "graph-123", content: "retry-policy Always retry MCP calls up to 3 times", kind: "semantic" },
    })
    expect(calls[1].arguments.content).toBe("auth-flow Use device code flow for CLI login")
  })

  test("does not re-forward the same entry on a later event", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ide-memory-data-"))
    const directory = mkdtempSync(path.join(tmpdir(), "ide-memory-project-"))
    writeCorrections(dataDir, directory, "## Decisions\n- k :: v\n")
    const calls: unknown[] = []
    const client: IdeMemoryForwarder.McpToolClient = {
      callTool: async (params) => {
        calls.push(params)
        return { isError: false }
      },
    }
    const deps = { client, graphID: "graph-123", dataDir }

    await IdeMemoryForwarder.handle(savedEvent(directory, ["corrections.md"]), deps)
    await IdeMemoryForwarder.handle(savedEvent(directory, ["corrections.md"]), deps)

    expect(calls).toHaveLength(1)
  })

  test("forwards only newly added entries on a subsequent save", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ide-memory-data-"))
    const directory = mkdtempSync(path.join(tmpdir(), "ide-memory-project-"))
    writeCorrections(dataDir, directory, "## Decisions\n- k1 :: v1\n")
    const calls: unknown[] = []
    const client: IdeMemoryForwarder.McpToolClient = {
      callTool: async (params) => {
        calls.push(params)
        return { isError: false }
      },
    }
    const deps = { client, graphID: "graph-123", dataDir }
    await IdeMemoryForwarder.handle(savedEvent(directory, ["corrections.md"]), deps)
    expect(calls).toHaveLength(1)

    writeCorrections(dataDir, directory, "## Decisions\n- k1 :: v1\n- k2 :: v2\n")
    await IdeMemoryForwarder.handle(savedEvent(directory, ["corrections.md"]), deps)

    expect(calls).toHaveLength(2)
  })

  test("does nothing when the event is not a save", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ide-memory-data-"))
    const directory = mkdtempSync(path.join(tmpdir(), "ide-memory-project-"))
    writeCorrections(dataDir, directory, "## Decisions\n- k :: v\n")
    const calls: unknown[] = []
    const client: IdeMemoryForwarder.McpToolClient = {
      callTool: async (params) => {
        calls.push(params)
        return { isError: false }
      },
    }

    await IdeMemoryForwarder.handle(
      { ...savedEvent(directory, ["corrections.md"]), detail: { type: "skipped", message: "no new items" } },
      { client, graphID: "graph-123", dataDir },
    )

    expect(calls).toHaveLength(0)
  })

  test("does nothing when corrections.md is not among the changed files", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ide-memory-data-"))
    const directory = mkdtempSync(path.join(tmpdir(), "ide-memory-project-"))
    writeCorrections(dataDir, directory, "## Decisions\n- k :: v\n")
    const calls: unknown[] = []
    const client: IdeMemoryForwarder.McpToolClient = {
      callTool: async (params) => {
        calls.push(params)
        return { isError: false }
      },
    }

    await IdeMemoryForwarder.handle(savedEvent(directory, ["project.md"]), { client, graphID: "graph-123", dataDir })

    expect(calls).toHaveLength(0)
  })

  test("does nothing without a connected docgraph client", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ide-memory-data-"))
    const directory = mkdtempSync(path.join(tmpdir(), "ide-memory-project-"))
    writeCorrections(dataDir, directory, "## Decisions\n- k :: v\n")

    // Should not throw even though there is no client to call.
    await IdeMemoryForwarder.handle(savedEvent(directory, ["corrections.md"]), {
      client: undefined,
      graphID: "graph-123",
      dataDir,
    })
  })

  test("does nothing when corrections.md does not exist yet", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ide-memory-data-"))
    const directory = mkdtempSync(path.join(tmpdir(), "ide-memory-project-"))
    const calls: unknown[] = []
    const client: IdeMemoryForwarder.McpToolClient = {
      callTool: async (params) => {
        calls.push(params)
        return { isError: false }
      },
    }

    await IdeMemoryForwarder.handle(savedEvent(directory, ["corrections.md"]), { client, graphID: "graph-123", dataDir })

    expect(calls).toHaveLength(0)
  })
})
