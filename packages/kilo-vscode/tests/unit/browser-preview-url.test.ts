import { describe, expect, it } from "bun:test"
import { normalizeUrl } from "../../src/browser-preview/url"

describe("normalizeUrl", () => {
  it("returns null for empty input", () => {
    expect(normalizeUrl()).toBeNull()
    expect(normalizeUrl("")).toBeNull()
    expect(normalizeUrl("   ")).toBeNull()
  })

  it("defaults the scheme to http", () => {
    expect(normalizeUrl("localhost:3000")?.toString()).toBe("http://localhost:3000/")
    expect(normalizeUrl("example.com/path?x=1")?.toString()).toBe("http://example.com/path?x=1")
  })

  it("keeps explicit https", () => {
    expect(normalizeUrl("https://example.com")?.toString()).toBe("https://example.com/")
  })

  it("preserves path, query, and hash", () => {
    const url = normalizeUrl("https://example.com/docs/page?a=1#top")
    expect(url?.pathname).toBe("/docs/page")
    expect(url?.search).toBe("?a=1")
    expect(url?.hash).toBe("#top")
  })

  it("rejects non-http protocols", () => {
    expect(normalizeUrl("file:///etc/passwd")).toBeNull()
    expect(normalizeUrl("ftp://example.com")).toBeNull()
    expect(normalizeUrl("javascript:alert(1)")).toBeNull()
  })

  it("returns null for unparseable input", () => {
    expect(normalizeUrl("http://")).toBeNull()
  })
})
