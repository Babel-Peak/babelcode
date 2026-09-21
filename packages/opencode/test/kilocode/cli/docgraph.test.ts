// kilocode_change - new file
// `kilo docgraph link/status` write/read the workspace's project-local
// config, not the global one -- so a fresh, isolated tmp directory (its own
// git repo, its own worktree root) is the right fixture. `create`/`ingest`'s
// full happy paths need a configured docgraph_api (global config) and a real
// network call, both already covered independently by
// docgraph-api.test.ts/workspace-zip.test.ts -- this file covers the
// project-config wiring (link, status, the --as label path, and ingest's
// "no bound graph" guard) without touching real global config.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import {
  gitRemoteHost,
  ingest,
  link,
  normalizeGitRemoteUrl,
  patchTopLevelJsonc,
  status,
} from "../../../src/kilocode/cli/cmd/docgraph"

// pickGraphInteractively (the @clack/prompts-driven picker) is covered in
// docgraph-picker.test.ts, in its own file: it needs mock.module("@clack/prompts", ...),
// which replaces that module process-wide for the whole test file it's declared
// in -- isolating it avoids any risk of that mock leaking into the real
// bootstrap()/instance-init machinery these link/status/ingest tests exercise.

describe("patchTopLevelJsonc", () => {
  test("adds a new top-level key to an empty document", () => {
    const result = patchTopLevelJsonc("{}", { docgraph: { graph_id: "abc" } })
    expect(JSON.parse(result)).toEqual({ docgraph: { graph_id: "abc" } })
  })

  test("replaces an existing top-level key wholesale", () => {
    const result = patchTopLevelJsonc(
      JSON.stringify({ docgraph: { graph_id: "old" }, other: true }),
      { docgraph: { graph_id: "new" } },
    )
    expect(JSON.parse(result)).toEqual({ docgraph: { graph_id: "new" }, other: true })
  })

  test("skips undefined values", () => {
    const result = patchTopLevelJsonc("{}", { docgraph: undefined })
    expect(JSON.parse(result)).toEqual({})
  })
})

describe("normalizeGitRemoteUrl / gitRemoteHost", () => {
  test("leaves an HTTPS remote untouched", () => {
    expect(normalizeGitRemoteUrl("https://github.com/Babel-Peak/babelcode.git")).toBe(
      "https://github.com/Babel-Peak/babelcode.git",
    )
  })

  test("converts an SSH remote to its HTTPS equivalent", () => {
    expect(normalizeGitRemoteUrl("git@github.com:Babel-Peak/babelcode.git")).toBe(
      "https://github.com/Babel-Peak/babelcode.git",
    )
  })

  test("converts an SSH remote with no .git suffix", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:babelpeak/docgraph")).toBe(
      "https://gitlab.com/babelpeak/docgraph.git",
    )
  })

  test("extracts the host from either form", () => {
    expect(gitRemoteHost("https://github.com/Babel-Peak/babelcode.git")).toBe("github.com")
    expect(gitRemoteHost("git@gitlab.com:babelpeak/docgraph.git")).toBe("gitlab.com")
  })
})

describe("docgraph link/status", () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  test("writes graph_id into a new project-local kilo.jsonc", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kilo-docgraph-link-"))
    execSync("git init -q", { cwd: dir })

    await link({ graphID: "graph-123", directory: dir })

    const written = readFileSync(path.join(dir, ".kilo", "kilo.jsonc"), "utf8")
    expect(JSON.parse(written).docgraph).toEqual({ graph_id: "graph-123" })
  })

  test("re-linking to a different graph_id overwrites the previous one", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kilo-docgraph-link-"))
    execSync("git init -q", { cwd: dir })

    await link({ graphID: "graph-first", directory: dir })
    await link({ graphID: "graph-second", directory: dir })

    // The config runtime's own load path may add unrelated keys (e.g. $schema)
    // to an existing file on a later bootstrap -- assert on the field this
    // command owns, not the whole document.
    const written = readFileSync(path.join(dir, ".kilo", "kilo.jsonc"), "utf8")
    expect(JSON.parse(written).docgraph).toEqual({ graph_id: "graph-second" })
  })

  test("linking with --as registers a named secondary graph without touching the primary one", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kilo-docgraph-link-"))
    execSync("git init -q", { cwd: dir })

    await link({ graphID: "primary-graph", directory: dir })
    await link({ graphID: "secondary-graph", label: "frontend", directory: dir })

    const written = JSON.parse(readFileSync(path.join(dir, ".kilo", "kilo.jsonc"), "utf8"))
    expect(written.docgraph.graph_id).toBe("primary-graph")
    expect(written.docgraph.graphs).toEqual([{ label: "frontend", graph_id: "secondary-graph" }])
  })

  test("re-registering the same label replaces its entry instead of duplicating it", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kilo-docgraph-link-"))
    execSync("git init -q", { cwd: dir })

    await link({ graphID: "graph-a", label: "frontend", directory: dir })
    await link({ graphID: "graph-b", label: "frontend", directory: dir })

    const written = JSON.parse(readFileSync(path.join(dir, ".kilo", "kilo.jsonc"), "utf8"))
    expect(written.docgraph.graphs).toEqual([{ label: "frontend", graph_id: "graph-b" }])
  })

  test("status reports the resolved directory, primary graph, and named graphs", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kilo-docgraph-link-"))
    execSync("git init -q", { cwd: dir })
    await link({ graphID: "primary-graph", directory: dir })
    await link({ graphID: "secondary-graph", label: "frontend", directory: dir })

    const written: string[] = []
    const writeSpy = spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write)
    try {
      await status(dir)
    } finally {
      writeSpy.mockRestore()
    }
    const output = written.join("")

    expect(output).toContain("Primary graph: primary-graph")
    expect(output).toContain("frontend -> secondary-graph")
  })

  test("ingest without a bound graph and without --graph-id fails with a clear message", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kilo-docgraph-link-"))
    execSync("git init -q", { cwd: dir })

    await expect(ingest({ directory: dir })).rejects.toThrow(/has no bound graph/)
  })
})
