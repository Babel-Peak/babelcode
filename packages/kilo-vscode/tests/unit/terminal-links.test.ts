import { describe, expect, it } from "bun:test"
import { detectTerminalLinks } from "../../src/services/terminal-links"

describe("detectTerminalLinks", () => {
  it("finds http and https URLs", () => {
    const links = detectTerminalLinks("see http://example.com and https://a.dev/x?y=1")
    expect(links.map((l) => l.url)).toEqual(["http://example.com", "https://a.dev/x?y=1"])
    expect(links[0]?.startIndex).toBe(4)
    expect(links[0]?.length).toBe("http://example.com".length)
  })

  it("finds localhost with a port", () => {
    const links = detectTerminalLinks("running on localhost:3000/dashboard")
    expect(links.map((l) => l.url)).toEqual(["localhost:3000/dashboard"])
  })

  it("finds loopback IPs with a port", () => {
    const links = detectTerminalLinks("serve at 127.0.0.1:8080 or 192.168.0.5:5173 now")
    expect(links.map((l) => l.url)).toEqual(["127.0.0.1:8080", "192.168.0.5:5173"])
  })

  it("ignores bare IP addresses without a port", () => {
    expect(detectTerminalLinks("version 1.2.3.4 released")).toEqual([])
  })

  it("strips trailing punctuation from URLs", () => {
    const links = detectTerminalLinks("visit http://example.com/docs, then http://a.io/x?ok=1.")
    expect(links.map((l) => l.url)).toEqual(["http://example.com/docs", "http://a.io/x?ok=1"])
  })

  it("returns nothing for lines without URLs", () => {
    expect(detectTerminalLinks("no links here, just localhost without port")).toEqual([])
  })

  it("finds multiple links in one line", () => {
    const links = detectTerminalLinks("a http://a.io b http://b.io")
    expect(links).toHaveLength(2)
    expect(links[1]?.startIndex).toBe(16)
  })

  it("does not match ports that are too short to be ports", () => {
    expect(detectTerminalLinks("localhost:3 is a typo")).toEqual([])
  })
})
