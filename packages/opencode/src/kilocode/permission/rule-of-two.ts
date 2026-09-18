/**
 * Detection helpers for Meta's "Agents Rule of Two": a session must never hold
 * all three of {private data, untrusted content, external egress} at once.
 * Wired into Permission.observeToolResult (permission/index.ts), which tracks
 * the first two per session and gates egress-capable permissions once both
 * are present -- see that file for the actual state/gating logic.
 */

// Tool IDs from the docgraph MCP server are namespaced `docgraph_<tool>`
// (McpCatalog.toolName sanitizes and joins the configured server name --
// "docgraph" is this deployment's configured name in kilo.jsonc). Any call
// into it means the session is now operating over tenant-private knowledge.
const DOCGRAPH_TOOL_PREFIX = "docgraph_"

// Matches the risk="0.NN" attribute docgraph's MCP layer stamps onto every
// piece of raw ingested content it returns (app/mcp/tools.py's
// _wrap_untrusted), e.g. `<untrusted_external_content source="..." risk="0.40">`.
const UNTRUSTED_CONTENT_RISK_PATTERN = /<untrusted_external_content\b[^>]*\brisk="([0-9.]+)"/g

// Below this, content is technically tagged untrusted but not flagged by
// docgraph's ingest-time heuristics as containing anything suspicious --
// treating every retrieved document as "untrusted content acquired" would
// make the gate fire on ordinary, everyday retrieval and defeat its purpose.
const UNTRUSTED_CONTENT_RISK_THRESHOLD = 0.3

// Permissions capable of moving data outside the sandbox; these are what get
// hard-blocked once a session has acquired both of the other two legs.
const GATED_PERMISSIONS = ["bash", "webfetch"] as const

export namespace RuleOfTwo {
  export type GatedPermission = (typeof GATED_PERMISSIONS)[number]

  export function isPrivateDataTool(toolID: string): boolean {
    return toolID.startsWith(DOCGRAPH_TOOL_PREFIX)
  }

  export function maxUntrustedContentRisk(output: string | undefined): number {
    if (!output) return 0
    let max = 0
    for (const match of output.matchAll(UNTRUSTED_CONTENT_RISK_PATTERN)) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > max) max = value
    }
    return max
  }

  export function isUntrustedContent(output: string | undefined): boolean {
    return maxUntrustedContentRisk(output) >= UNTRUSTED_CONTENT_RISK_THRESHOLD
  }

  export function gatedPermissions(): readonly GatedPermission[] {
    return GATED_PERMISSIONS
  }
}
