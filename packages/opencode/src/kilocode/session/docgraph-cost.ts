// kilocode_change - new file
// Phase 13: fetches this session's docgraph-side cost (GET
// /stats/costs/session/{session_id}, filtered by the same X-Kilo-Session-Id
// every MCP call to docgraph already carries -- see session-correlation.ts)
// so the extension can show one combined "whole operation cost" instead of
// only the local provider spend ModelUsage.get already computes.
//
// Reuses the existing docgraph_events config (url + api_key) rather than
// asking for a second credential -- that credential's X-API-Key already
// works here since /stats/costs/session/{id} isn't scope-gated beyond
// requiring any valid one. Best-effort, same philosophy as
// AgentEventsForwarder: a slow or unreachable docgraph must never fail or
// slow down the local usage response this is merged into.
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "docgraph-cost" })

export interface DocgraphSessionCost {
  totalUsd: number
  rows: { purpose: string; costUsd: number }[]
}

interface DocgraphEventsConfig {
  url?: string
  api_key?: string
}

interface SessionCostResponse {
  total_usd?: number
  rows?: { purpose: string; cost_usd: number }[]
}

export async function fetchDocgraphSessionCost(
  config: DocgraphEventsConfig | undefined,
  sessionID: string,
): Promise<DocgraphSessionCost | undefined> {
  if (!config?.url || !config.api_key) return undefined
  const base = config.url.replace(/\/+$/, "")
  const url = `${base}/stats/costs/session/${encodeURIComponent(sessionID)}`
  try {
    const response = await fetch(url, { headers: { "X-API-Key": config.api_key } })
    if (!response.ok) {
      log.warn("session cost fetch rejected", { status: response.status })
      return undefined
    }
    const data = (await response.json()) as SessionCostResponse
    return {
      totalUsd: typeof data.total_usd === "number" ? data.total_usd : 0,
      rows: (data.rows ?? []).map((row) => ({ purpose: row.purpose, costUsd: row.cost_usd })),
    }
  } catch (error) {
    log.warn("session cost fetch failed", { error: String(error) })
    return undefined
  }
}
