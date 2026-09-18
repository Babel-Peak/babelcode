// kilocode_change - new file
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js"
import { buildWorkspaceZip } from "../../../src/kilocode/session/workspace-zip"

async function zipEntryNames(bytes: Uint8Array): Promise<string[]> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  const entries = await reader.getEntries()
  await reader.close()
  return entries.map((entry) => entry.filename).sort()
}

async function zipEntryText(bytes: Uint8Array, name: string): Promise<string> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  const entries = await reader.getEntries()
  const entry = entries.find((item) => item.filename === name)
  if (!entry?.getData) throw new Error(`entry not found: ${name}`)
  const text = new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter()))
  await reader.close()
  return text
}

describe("buildWorkspaceZip", () => {
  test("zips regular files, skipping .git", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workspace-zip-"))
    writeFileSync(path.join(dir, "README.md"), "# hello")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "index.ts"), "export const x = 1")
    mkdirSync(path.join(dir, ".git"), { recursive: true })
    writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main")

    const zip = await buildWorkspaceZip(dir)
    const names = await zipEntryNames(zip)

    expect(names).toEqual(["README.md", "src/index.ts"])
    expect(await zipEntryText(zip, "README.md")).toBe("# hello")
  })

  test("respects .gitignore", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workspace-zip-"))
    writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n*.log\n")
    writeFileSync(path.join(dir, "app.ts"), "console.log(1)")
    writeFileSync(path.join(dir, "debug.log"), "noisy")
    mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true })
    writeFileSync(path.join(dir, "node_modules", "dep", "index.js"), "module.exports = {}")

    const zip = await buildWorkspaceZip(dir)
    const names = await zipEntryNames(zip)

    expect(names).toEqual([".gitignore", "app.ts"])
  })

  test("respects .ignore in addition to .gitignore", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workspace-zip-"))
    writeFileSync(path.join(dir, ".ignore"), "secrets.env\n")
    writeFileSync(path.join(dir, "app.ts"), "console.log(1)")
    writeFileSync(path.join(dir, "secrets.env"), "TOKEN=xyz")

    const zip = await buildWorkspaceZip(dir)
    const names = await zipEntryNames(zip)

    expect(names).toEqual([".ignore", "app.ts"])
  })

  test("throws when the workspace exceeds the size cap", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workspace-zip-"))
    writeFileSync(path.join(dir, "big.bin"), Buffer.alloc(1024))

    await expect(buildWorkspaceZip(dir, { maxBytes: 100 })).rejects.toThrow(/larger than/)
  })

  test("default cap is generous (sanity check on the exported constant)", async () => {
    const { MAX_WORKSPACE_ZIP_BYTES } = await import("../../../src/kilocode/session/workspace-zip")
    expect(MAX_WORKSPACE_ZIP_BYTES).toBeGreaterThan(100 * 1024 * 1024)
  })
})
