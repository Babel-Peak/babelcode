// kilocode_change - new file
// Best-effort per-developer identity sent only to the docgraph MCP client
// (not arbitrary configured remote MCP servers -- see docgraph-graph-id.ts's
// identical clientName guard), so cost/audit attribution in docgraph can go
// one level deeper than the shared bearer token in kilo.jsonc. This fork is
// BabelPeak-internal with no Kilo cloud accounts to piggyback on, so the
// identity is this machine's own `git config user.email` rather than an
// OAuth accountId: self-asserted, not cryptographically verified, which is
// an acceptable trust model for a small team already sharing one bearer
// token. Resolved once per connection (see mcp/index.ts's connectRemote): a
// developer's email doesn't change mid-session the way concurrent session
// ids sharing one client can.
import { execFileSync } from "node:child_process"

export const USER_IDENTITY_HEADER = "X-Kilo-User-Id"

export function resolveDocgraphUserIdHeader(input: {
  clientName: string
  identity: string | undefined
}): Record<string, string> {
  if (input.clientName !== "docgraph") return {}
  if (!input.identity) return {}
  return { [USER_IDENTITY_HEADER]: input.identity }
}

/** Reads `git config user.email` once per call; callers should cache the result for a connection's lifetime. */
export function resolveGitUserEmail(
  exec: (command: string, args: string[]) => string = defaultGitExec,
): string | undefined {
  try {
    return exec("git", ["config", "--get", "user.email"]).trim() || undefined
  } catch {
    return undefined
  }
}

function defaultGitExec(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
}
