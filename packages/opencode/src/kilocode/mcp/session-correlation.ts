// kilocode_change - new file
// Injects an X-Kilo-Session-Id header on every outgoing remote-MCP HTTP
// request, so docgraph (or any remote MCP server) can attribute cost and
// telemetry back to the local session that made the call -- the same
// session id AgentEventsForwarder already sends to docgraph's
// agent_sessions sink, reused here rather than inventing a second id.
//
// The MCP SDK's client transports bake `requestInit.headers` in once at
// connect time (no per-call header hook), and mutating that shared object
// per call would race across concurrent sessions sharing one MCP client.
// Instead this reads the *current* session id from ambient context (ordinary
// AsyncLocalStorage, ping-ponging through native async/await is safe;
// detached timers/worker threads are not, but none are involved in the
// tool-call path this is used from) at the moment each HTTP request is
// actually sent, and sets it on that request's own (already per-call) Headers
// object -- mirroring the `instanceContext`/`LocalContext` ambient-context
// pattern already used for the legacy Bus facade (bus/index.ts).
import { LocalContext } from "@/util/local-context"

export const MCP_SESSION_HEADER = "X-Kilo-Session-Id"

export const CurrentMcpSessionID = LocalContext.create<string>("mcp-session-id")

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function withMcpSessionCorrelation(baseFetch: FetchLike): FetchLike {
  return async (input, init) => {
    let sessionID: string | undefined
    try {
      sessionID = CurrentMcpSessionID.use()
    } catch {
      sessionID = undefined
    }
    if (!sessionID) return baseFetch(input, init)
    const headers = new Headers(init?.headers)
    headers.set(MCP_SESSION_HEADER, sessionID)
    return baseFetch(input, { ...init, headers })
  }
}
