// kilocode_change - new file
// AgentEventsForwarder.emit is fire-and-forget: disabled unless both url and
// api_key are configured, never throws, and posts the expected shape when enabled.
import { afterEach, describe, expect, mock, test } from "bun:test"
import { AgentEventsForwarder } from "../../../src/kilocode/telemetry/agent-events-forwarder"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("AgentEventsForwarder.emit", () => {
  test("does nothing when url is missing", () => {
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    AgentEventsForwarder.emit({ api_key: "secret" }, "ses_1", "tool.executed", { tool: "bash" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("does nothing when api_key is missing", () => {
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    AgentEventsForwarder.emit({ url: "https://api.example.com" }, "ses_1", "tool.executed", { tool: "bash" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("does nothing when config is undefined", () => {
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    AgentEventsForwarder.emit(undefined, "ses_1", "tool.executed", { tool: "bash" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("posts a single-event batch to the session's events endpoint", async () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 202 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    AgentEventsForwarder.emit(
      { url: "https://api.example.com/", api_key: "secret-key" },
      "ses_1",
      "permission.rule_of_two_gated",
      { permissions: ["bash", "webfetch"] },
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/agent/sessions/ses_1/events")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("secret-key")
    expect(JSON.parse(init.body as string)).toEqual({
      events: [{ event_type: "permission.rule_of_two_gated", payload: { permissions: ["bash", "webfetch"] } }],
    })
  })

  test("swallows fetch rejections without throwing", () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch
    expect(() => AgentEventsForwarder.emit({ url: "https://api.example.com", api_key: "k" }, "ses_1", "tool.executed")).not.toThrow()
  })

  test("URL-encodes the session id", () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 202 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    AgentEventsForwarder.emit({ url: "https://api.example.com", api_key: "k" }, "ses/weird id", "tool.executed")
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe("https://api.example.com/agent/sessions/ses%2Fweird%20id/events")
  })
})
