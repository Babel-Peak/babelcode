// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { CurrentMcpSessionID, MCP_SESSION_HEADER, withMcpSessionCorrelation } from "../../../src/kilocode/mcp/session-correlation"

describe("withMcpSessionCorrelation", () => {
  test("adds the session header when a session id is provided", async () => {
    let seenHeaders: Headers | undefined
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response(null)
    }
    const wrapped = withMcpSessionCorrelation(fakeFetch)

    await CurrentMcpSessionID.provide("ses_abc123", () => wrapped("https://example.com/mcp"))

    expect(seenHeaders?.get(MCP_SESSION_HEADER)).toBe("ses_abc123")
  })

  test("does nothing when no session id is in context", async () => {
    let seenHeaders: Headers | undefined
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response(null)
    }
    const wrapped = withMcpSessionCorrelation(fakeFetch)

    await wrapped("https://example.com/mcp")

    expect(seenHeaders?.has(MCP_SESSION_HEADER)).toBe(false)
  })

  test("preserves existing headers alongside the new one", async () => {
    let seenHeaders: Headers | undefined
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response(null)
    }
    const wrapped = withMcpSessionCorrelation(fakeFetch)

    await CurrentMcpSessionID.provide("ses_xyz", () =>
      wrapped("https://example.com/mcp", { headers: { Authorization: "Bearer token" } }),
    )

    expect(seenHeaders?.get("Authorization")).toBe("Bearer token")
    expect(seenHeaders?.get(MCP_SESSION_HEADER)).toBe("ses_xyz")
  })

  test("isolates concurrent calls with different session ids (the race the shared-header approach would hit)", async () => {
    const seen: string[] = []
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      // Yield control so a real race would interleave here if state were shared.
      await new Promise((resolve) => setTimeout(resolve, 5))
      seen.push(new Headers(init?.headers).get(MCP_SESSION_HEADER) ?? "none")
      return new Response(null)
    }
    const wrapped = withMcpSessionCorrelation(fakeFetch)

    await Promise.all([
      CurrentMcpSessionID.provide("ses_one", () => wrapped("https://example.com/mcp")),
      CurrentMcpSessionID.provide("ses_two", () => wrapped("https://example.com/mcp")),
    ])

    expect(seen.sort()).toEqual(["ses_one", "ses_two"])
  })
})
