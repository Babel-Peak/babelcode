// kilocode_change - new file
// Best-effort per-developer identity sent only to the docgraph MCP client
// (not arbitrary configured remote MCP servers -- see docgraph-graph-id.ts's
// identical clientName guard), so cost/audit attribution in docgraph can go
// one level deeper than a possibly-shared API key. Unlike
// session-correlation.ts's per-call header, this is resolved once per
// connection (see mcp/index.ts's connectRemote): the developer's identity
// doesn't change mid-session the way concurrent session ids sharing one
// client can.
import type { Auth } from "@/auth"

export const USER_IDENTITY_HEADER = "X-Kilo-User-Id"

export function resolveDocgraphUserIdHeader(input: {
  clientName: string
  authInfo: Auth.Info | undefined
}): Record<string, string> {
  if (input.clientName !== "docgraph") return {}
  if (input.authInfo?.type !== "oauth" || !input.authInfo.accountId) return {}
  return { [USER_IDENTITY_HEADER]: input.authInfo.accountId }
}
