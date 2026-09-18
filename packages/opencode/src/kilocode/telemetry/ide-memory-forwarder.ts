// kilocode_change - new file
// Forwards kilo-memory's own captured decisions/corrections content into
// docgraph as private, per-developer memory via the propose_memory MCP tool
// (Phase 11) -- so it becomes durable, retrievable knowledge instead of
// living only in this one local workspace's memory files. kilo-memory
// already redacts and categorizes captured content; this only reads
// corrections.md (its file for exactly this kind of content, see
// MemoryPaths.source's fallback branch) and republishes what's already
// there. Mirrors AgentEventsForwarder's shape: fire-and-forget, no-op until
// the workspace is bound to a graph (`kilo docgraph link`) and the docgraph
// MCP client is connected -- never blocks or fails the memory-save path that
// triggered it.
//
// graph_id auto-fill (docgraph-graph-id.ts) and the X-Kilo-Session-Id/
// X-Kilo-User-Id headers (session-correlation.ts, docgraph-user-id.ts) only
// apply to the model-driven tool-execute path in session/tools.ts, not a
// direct client.callTool() like this -- graph_id is passed explicitly below,
// and the user-id header still applies because it is a static per-connection
// header set once in mcp/index.ts's connectRemote, not a per-call one.
//
// `client`/`dataDir` are injected by the caller (bootstrap.ts) rather than
// resolved in here (MCP.Service.clients(), Global.Path.data), so this module
// stays plain Promise code, testable with fakes and a tmpdir -- the same
// reasoning as docgraph.ts's CLI `link()` taking an explicit `directory`.
import { readFileSync } from "node:fs"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { MemoryPaths } from "@kilocode/kilo-memory/paths"
import { MemoryShared } from "@kilocode/kilo-memory/shared"
import * as Log from "@opencode-ai/core/util/log"
import type { MemoryEvents } from "@/kilocode/memory/events"

const log = Log.create({ service: "ide-memory-forwarder" })

const CORRECTIONS_FILE = "corrections.md"

export namespace IdeMemoryForwarder {
  export const DOCGRAPH_CLIENT_NAME = "docgraph"

  export interface McpToolClient {
    callTool: (
      params: { name: string; arguments: Record<string, unknown> },
      resultSchema: unknown,
      options?: { timeout?: number },
    ) => Promise<{ isError?: boolean }>
  }

  export interface Deps {
    client: McpToolClient | undefined
    graphID: string
    dataDir: string
  }

  // In-process only: a restart re-forwards one round of already-seen entries,
  // which docgraph's own near-duplicate reconciliation turns into a NOOP
  // rather than a duplicate row -- an acceptable tradeoff for not adding yet
  // another local state file to a best-effort telemetry path.
  const forwarded = new Map<string, Set<string>>()

  export async function handle(evt: MemoryEvents.Status, deps: Deps): Promise<void> {
    if (evt.detail?.type !== "saved") return
    if (!evt.detail.files?.includes(CORRECTIONS_FILE)) return
    if (!deps.client) return

    const root = MemoryPaths.root({
      ctx: { directory: evt.directory, worktree: "/" }, // kilocode_change - no worktree on the event payload; "/" makes base() fall back to directory
      data: deps.dataDir,
    })
    const file = MemoryPaths.files(root).corrections
    let text: string
    try {
      text = readFileSync(file, "utf8")
    } catch {
      return
    }

    const entries = MemoryShared.source({ file: "corrections.md", text })
    const seen = forwarded.get(root) ?? new Set<string>()
    const fresh = entries.filter((entry) => !seen.has(entry.id))
    if (fresh.length === 0) return

    for (const entry of fresh) {
      seen.add(entry.id)
      try {
        const result = await deps.client.callTool(
          { name: "propose_memory", arguments: { graph_id: deps.graphID, content: entry.text, kind: "semantic" } },
          CallToolResultSchema,
          { timeout: 10_000 },
        )
        if (result.isError) log.warn("propose_memory tool call rejected", { id: entry.id })
      } catch (err) {
        log.warn("propose_memory forward failed", { id: entry.id, err: String(err) })
      }
    }
    forwarded.set(root, seen)
  }
}
