// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { resolveDocgraphUserIdHeader, USER_IDENTITY_HEADER } from "../../../src/kilocode/mcp/docgraph-user-id"

describe("resolveDocgraphUserIdHeader", () => {
  test("sends the header for the docgraph client when oauth accountId is present", () => {
    const result = resolveDocgraphUserIdHeader({
      clientName: "docgraph",
      authInfo: { type: "oauth", refresh: "r", access: "a", expires: 0, accountId: "acct-123" },
    })
    expect(result).toEqual({ [USER_IDENTITY_HEADER]: "acct-123" })
  })

  test("does nothing for a non-docgraph MCP server", () => {
    const result = resolveDocgraphUserIdHeader({
      clientName: "some-other-server",
      authInfo: { type: "oauth", refresh: "r", access: "a", expires: 0, accountId: "acct-123" },
    })
    expect(result).toEqual({})
  })

  test("does nothing when auth info is undefined", () => {
    const result = resolveDocgraphUserIdHeader({ clientName: "docgraph", authInfo: undefined })
    expect(result).toEqual({})
  })

  test("does nothing for api-key auth, which carries no accountId", () => {
    const result = resolveDocgraphUserIdHeader({
      clientName: "docgraph",
      authInfo: { type: "api", key: "sk-123" },
    })
    expect(result).toEqual({})
  })

  test("does nothing when oauth info is missing accountId", () => {
    const result = resolveDocgraphUserIdHeader({
      clientName: "docgraph",
      authInfo: { type: "oauth", refresh: "r", access: "a", expires: 0 },
    })
    expect(result).toEqual({})
  })
})
