// kilocode_change - new file
import { describe, expect, test, mock, afterEach } from "bun:test"
import { fetchDocgraphSessionCost } from "../../../src/kilocode/session/docgraph-cost"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("fetchDocgraphSessionCost", () => {
  test("returns undefined when docgraph_events is not configured", async () => {
    const result = await fetchDocgraphSessionCost(undefined, "ses_abc")
    expect(result).toBeUndefined()
  })

  test("returns undefined when only url is set", async () => {
    const result = await fetchDocgraphSessionCost({ url: "https://api.example.com" }, "ses_abc")
    expect(result).toBeUndefined()
  })

  test("returns undefined when only api_key is set", async () => {
    const result = await fetchDocgraphSessionCost({ api_key: "key" }, "ses_abc")
    expect(result).toBeUndefined()
  })

  test("fetches and maps the session cost response", async () => {
    let seenUrl: string | undefined
    let seenHeaders: HeadersInit | undefined
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(input)
      seenHeaders = init?.headers
      return new Response(
        JSON.stringify({
          session_id: "ses_abc",
          total_usd: 0.123,
          rows: [
            { purpose: "search_knowledge", cost_usd: 0.1 },
            { purpose: "recall_memory_as_of", cost_usd: 0.023 },
          ],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const result = await fetchDocgraphSessionCost(
      { url: "https://api.example.com/", api_key: "the-key" },
      "ses_abc",
    )

    expect(seenUrl).toBe("https://api.example.com/stats/costs/session/ses_abc")
    expect(new Headers(seenHeaders).get("X-API-Key")).toBe("the-key")
    expect(result).toEqual({
      totalUsd: 0.123,
      rows: [
        { purpose: "search_knowledge", costUsd: 0.1 },
        { purpose: "recall_memory_as_of", costUsd: 0.023 },
      ],
    })
  })

  test("strips a trailing slash from the configured base url", async () => {
    let seenUrl: string | undefined
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      seenUrl = String(input)
      return new Response(JSON.stringify({ total_usd: 0, rows: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await fetchDocgraphSessionCost({ url: "https://api.example.com///", api_key: "k" }, "ses_xyz")

    expect(seenUrl).toBe("https://api.example.com/stats/costs/session/ses_xyz")
  })

  test("url-encodes the session id", async () => {
    let seenUrl: string | undefined
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      seenUrl = String(input)
      return new Response(JSON.stringify({ total_usd: 0, rows: [] }), { status: 200 })
    }) as unknown as typeof fetch

    await fetchDocgraphSessionCost({ url: "https://api.example.com", api_key: "k" }, "ses/weird?id")

    expect(seenUrl).toBe("https://api.example.com/stats/costs/session/ses%2Fweird%3Fid")
  })

  test("returns undefined on a non-ok response", async () => {
    globalThis.fetch = mock(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch

    const result = await fetchDocgraphSessionCost({ url: "https://api.example.com", api_key: "k" }, "ses_abc")

    expect(result).toBeUndefined()
  })

  test("returns undefined when fetch throws", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const result = await fetchDocgraphSessionCost({ url: "https://api.example.com", api_key: "k" }, "ses_abc")

    expect(result).toBeUndefined()
  })

  test("defaults total and rows when the response body is missing them", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch

    const result = await fetchDocgraphSessionCost({ url: "https://api.example.com", api_key: "k" }, "ses_abc")

    expect(result).toEqual({ totalUsd: 0, rows: [] })
  })
})
