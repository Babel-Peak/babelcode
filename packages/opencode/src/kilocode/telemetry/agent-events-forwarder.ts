// kilocode_change - new file
// Best-effort forwarder to docgraph's POST /agent/sessions/{id}/events sink
// (docgraph-sota-harness-plan.md Phase 2). Deliberately not routed through
// packages/kilo-telemetry: that package is PostHog product analytics, a
// different destination with a different schema and consent model, not an
// event-bus hook this can subscribe alongside. Deliberately not batched or
// retried either -- this is fire-and-forget observability, not a delivery
// guarantee, and a slow/unreachable docgraph must never add latency to a
// tool call or block the session.
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "agent-events-forwarder" })

export namespace AgentEventsForwarder {
  export interface Config {
    url?: string
    api_key?: string
  }

  export function emit(
    config: Config | undefined,
    sessionID: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): void {
    if (!config?.url || !config.api_key) return
    const base = config.url.replace(/\/+$/, "")
    const url = `${base}/agent/sessions/${encodeURIComponent(sessionID)}/events`
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.api_key },
      body: JSON.stringify({ events: [{ event_type: eventType, payload }] }),
    })
      .then((response) => {
        if (!response.ok) log.warn("agent event forward rejected", { eventType, status: response.status })
      })
      .catch((error) => {
        log.warn("agent event forward failed", { eventType, error: String(error) })
      })
  }
}
