// kilocode_change - new file
// Zips the current worktree for `kilo docgraph create --ingest`/`ingest`.
// Walks the directory on disk rather than using `git archive`, which would
// silently drop uncommitted work -- exactly the content a developer usually
// wants ingested when there's no docgraph graph yet. Skips `.git` and
// anything matched by .gitignore/.ignore, mirroring the same `ignore`
// package and convention already used by the file-search HTTP handler
// (server/routes/instance/httpapi/handlers/file.ts). Uses @zip.js/zip.js,
// already a dependency of this package (used elsewhere for reading
// zip-container document formats), instead of adding a new one.
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import ignoreFactory from "ignore"
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js"

const ALWAYS_SKIP = new Set([".git"])

// A generous but bounded cap: this ships over HTTP as one multipart request,
// not a resumable transfer -- a workspace this large should use docgraph's
// git-based ingest instead.
export const MAX_WORKSPACE_ZIP_BYTES = 200 * 1024 * 1024

async function readIgnoreFile(directory: string, filename: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(directory, filename), "utf8")
  } catch {
    return undefined
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const ignored = ignoreFactory()
  const gitignore = await readIgnoreFile(root, ".gitignore")
  if (gitignore) ignored.add(gitignore)
  const dotignore = await readIgnoreFile(root, ".ignore")
  if (dotignore) ignored.add(dotignore)

  const files: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (ALWAYS_SKIP.has(entry.name)) continue
      const absolute = path.join(dir, entry.name)
      const relative = path.relative(root, absolute)
      if (ignored.ignores(entry.isDirectory() ? `${relative}/` : relative)) continue
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (entry.isFile()) {
        files.push(relative)
      }
    }
  }
  await walk(root)
  return files
}

export async function buildWorkspaceZip(
  directory: string,
  options?: { maxBytes?: number },
): Promise<Uint8Array> {
  const maxBytes = options?.maxBytes ?? MAX_WORKSPACE_ZIP_BYTES
  const relativePaths = await collectFiles(directory)
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 6 })
  let totalBytes = 0
  try {
    for (const relativePath of relativePaths) {
      const content = await readFile(path.join(directory, relativePath))
      totalBytes += content.byteLength
      if (totalBytes > maxBytes) {
        throw new Error(
          `workspace is larger than ${Math.round(maxBytes / (1024 * 1024))}MB uncompressed -- ` +
            "use docgraph's git-based ingest for large repositories instead",
        )
      }
      // @zip.js/zip.js entry names always use forward slashes, regardless of platform.
      const entryName = relativePath.split(path.sep).join("/")
      await writer.add(entryName, new Uint8ArrayReader(new Uint8Array(content)))
    }
  } catch (error) {
    await writer.close().catch(() => {})
    throw error
  }
  return await writer.close()
}
