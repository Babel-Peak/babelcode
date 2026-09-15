// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { resolveDocgraphUserIdHeader, resolveGitUserEmail, USER_IDENTITY_HEADER } from "../../../src/kilocode/mcp/docgraph-user-id"

describe("resolveDocgraphUserIdHeader", () => {
  test("sends the header for the docgraph client when an identity is present", () => {
    const result = resolveDocgraphUserIdHeader({ clientName: "docgraph", identity: "dev@babelpeak.com" })
    expect(result).toEqual({ [USER_IDENTITY_HEADER]: "dev@babelpeak.com" })
  })

  test("does nothing for a non-docgraph MCP server", () => {
    const result = resolveDocgraphUserIdHeader({ clientName: "some-other-server", identity: "dev@babelpeak.com" })
    expect(result).toEqual({})
  })

  test("does nothing when identity is undefined", () => {
    const result = resolveDocgraphUserIdHeader({ clientName: "docgraph", identity: undefined })
    expect(result).toEqual({})
  })

  test("does nothing when identity is empty", () => {
    const result = resolveDocgraphUserIdHeader({ clientName: "docgraph", identity: "" })
    expect(result).toEqual({})
  })
})

describe("resolveGitUserEmail", () => {
  test("returns the trimmed output of git config user.email", () => {
    const result = resolveGitUserEmail(() => "dev@babelpeak.com\n")
    expect(result).toBe("dev@babelpeak.com")
  })

  test("returns undefined when git config has no user.email set", () => {
    const result = resolveGitUserEmail(() => "")
    expect(result).toBeUndefined()
  })

  test("returns undefined when the git invocation throws (no git, no repo, etc.)", () => {
    const result = resolveGitUserEmail(() => {
      throw new Error("not a git repository")
    })
    expect(result).toBeUndefined()
  })
})
