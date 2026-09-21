// kilocode_change - new file
// Pure helper for session/tools.ts's MCP tool-execute path: a docgraph tool
// result can cite a specific local file's content as it was when last
// ingested (`rel_path` + `content_sha256` in its provenance, see
// docgraph's api/app/mcp/tools.py `_provenance()`/`grep`/`search_knowledge`).
// If that file has since changed on disk -- in this session, a previous one,
// or manually outside the agent entirely, committed or not -- the model has
// no way to know the excerpt it just received is stale. This walks a tool
// result's parsed JSON for any such citation, hashes the live file, and
// reports every citation whose local content no longer matches the graph's,
// so session/tools.ts can prepend a warning banner to the flattened output.
// Kept pure and separate from the Effect-heavy call site so it's
// unit-testable without the full tool-execution scaffolding, mirroring
// docgraph-graph-id.ts/docgraph-user-id.ts.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { isRecord } from "@/util/record"

export type DocgraphStaleFile = {
  relPath: string
  status: "modified" | "deleted"
}

// Source files this feature cares about are never anywhere near this size;
// skip larger ones rather than hash them pointlessly on every tool result.
const MAX_HASHED_FILE_BYTES = 2 * 1024 * 1024

export function checkDocgraphStaleness(input: {
  clientName: string
  worktree: string
  textParts: string[]
}): DocgraphStaleFile[] {
  if (input.clientName !== "docgraph") return []

  const citations = collectCitations(input.textParts)
  const seen = new Set<string>()
  const stale: DocgraphStaleFile[] = []
  for (const citation of citations) {
    if (seen.has(citation.relPath)) continue
    seen.add(citation.relPath)

    const status = checkOne(input.worktree, citation)
    if (status) stale.push({ relPath: citation.relPath, status })
  }
  return stale
}

export function formatDocgraphStalenessWarning(stale: DocgraphStaleFile[]): string | undefined {
  if (stale.length === 0) return undefined
  const lines = stale.map((entry) =>
    entry.status === "modified"
      ? `- ${entry.relPath} — local content differs from the indexed version`
      : `- ${entry.relPath} — file not found locally (deleted or moved since last ingest)`,
  )
  return [
    "<stale_graph_content>",
    "Warning: this result cites the knowledge graph, which may be out of date for some files. Do not treat the graph excerpts below as current for these paths -- re-read them directly if accuracy matters:",
    ...lines,
    "</stale_graph_content>",
  ].join("\n")
}

type Citation = { relPath: string; contentSha256: string }

function collectCitations(textParts: string[]): Citation[] {
  const citations: Citation[] = []
  for (const part of textParts) {
    let parsed: unknown
    try {
      parsed = JSON.parse(part)
    } catch {
      continue
    }
    walk(parsed, citations)
  }
  return citations
}

function walk(value: unknown, out: Citation[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out)
    return
  }
  if (!isRecord(value)) return

  const relPath = value["rel_path"]
  const contentSha256 = value["content_sha256"]
  if (typeof relPath === "string" && relPath && typeof contentSha256 === "string" && contentSha256) {
    out.push({ relPath, contentSha256 })
  }
  for (const nested of Object.values(value)) walk(nested, out)
}

function checkOne(worktree: string, citation: Citation): "modified" | "deleted" | undefined {
  const absolutePath = FSUtil.resolve(join(worktree, citation.relPath))
  if (!FSUtil.contains(worktree, absolutePath)) return undefined
  if (!existsSync(absolutePath)) return "deleted"

  try {
    if (statSync(absolutePath).size > MAX_HASHED_FILE_BYTES) return undefined
    const hash = createHash("sha256").update(readFileSync(absolutePath)).digest("hex")
    return hash === citation.contentSha256 ? undefined : "modified"
  } catch {
    return undefined
  }
}
