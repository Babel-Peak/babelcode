// kilocode_change - new file
// pickGraphInteractively (kilocode/cli/cmd/docgraph.ts) needs
// mock.module("@clack/prompts", ...) to control the interactive select --
// @clack/prompts' real exports are an ES module namespace (read-only), so a
// plain `prompts.select = ...` reassignment throws at runtime. mock.module
// replaces the module process-wide for this whole test file, which is
// exactly why this lives in its own file, away from docgraph.test.ts's
// real bootstrap()/instance-init-driven link/status/ingest tests.
import { afterEach, describe, expect, mock, test } from "bun:test"

let selectImpl: (...args: unknown[]) => Promise<unknown> = async () => {
  throw new Error("select not configured for this test")
}
let isCancelImpl: (value: unknown) => boolean = () => false

// Spread the real module's other exports (spinner, log, intro/outro, ...) --
// something else pulled in transitively while loading docgraph.ts uses them,
// and mock.module replaces @clack/prompts process-wide, not just for
// docgraph.ts's own import of it.
//
// Import the real module BEFORE registering the mock, and close over that
// already-resolved object -- importing "@clack/prompts" again from inside
// the factory would resolve through the very mock being registered (it
// replaces the specifier process-wide), recursing forever instead of
// reaching the real module. That recursion is what made this file hang
// (TIMED OUT at 300s) rather than fail fast.
const realPrompts = await import("@clack/prompts")
mock.module("@clack/prompts", () => ({
  ...realPrompts,
  select: (...args: unknown[]) => selectImpl(...args),
  isCancel: (value: unknown) => isCancelImpl(value),
}))

const { pickGraphInteractively } = await import("../../../src/kilocode/cli/cmd/docgraph")

describe("pickGraphInteractively", () => {
  afterEach(() => {
    selectImpl = async () => {
      throw new Error("select not configured for this test")
    }
    isCancelImpl = () => false
  })

  test("returns the selected graph id", async () => {
    selectImpl = async () => "picked-id"

    const result = await pickGraphInteractively([
      { id: "picked-id", name: "Repo A", description: null, doc_count: 5 },
      { id: "other-id", name: "Repo B", description: null, doc_count: 0 },
    ])

    expect(result).toBe("picked-id")
  })

  test("throws when the list is empty, without prompting", async () => {
    const spy = mock(async () => "unused")
    selectImpl = spy

    await expect(pickGraphInteractively([])).rejects.toThrow(/No graphs found/)
    expect(spy).not.toHaveBeenCalled()
  })

  test("throws when the prompt is cancelled", async () => {
    const cancelSymbol = Symbol("cancel")
    selectImpl = async () => cancelSymbol
    isCancelImpl = (value) => value === cancelSymbol

    await expect(
      pickGraphInteractively([{ id: "g1", name: "Repo", description: null, doc_count: 1 }]),
    ).rejects.toThrow()
  })

  test("passes graph name as label and doc count as hint", async () => {
    let seenOptions: { value: string; label: string; hint: string }[] | undefined
    selectImpl = async (opts: unknown) => {
      seenOptions = (opts as { options: typeof seenOptions }).options
      return "g1"
    }

    await pickGraphInteractively([{ id: "g1", name: "My Repo", description: null, doc_count: 1 }])

    expect(seenOptions).toEqual([{ value: "g1", label: "My Repo", hint: "1 doc" }])
  })
})
