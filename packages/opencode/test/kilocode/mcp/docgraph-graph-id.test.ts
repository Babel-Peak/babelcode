// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { fillDocgraphGraphId } from "../../../src/kilocode/mcp/docgraph-graph-id"

const SCHEMA_WITH_GRAPH_ID = { graph_id: {}, query: {} }
const SCHEMA_WITHOUT_GRAPH_ID = { skill_id: {} }

describe("fillDocgraphGraphId", () => {
  test("fills graph_id when the model omitted it and a binding exists", () => {
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args: { query: "how does X work" },
      boundGraphId: "graph-123",
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toEqual({ query: "how does X work", graph_id: "graph-123" })
  })

  test("does not override a graph_id the model already supplied", () => {
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args: { query: "q", graph_id: "explicit-graph" },
      boundGraphId: "graph-123",
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toEqual({ query: "q", graph_id: "explicit-graph" })
  })

  test("does nothing for a non-docgraph MCP server", () => {
    const args = { query: "q" }
    const result = fillDocgraphGraphId({
      clientName: "some-other-server",
      args,
      boundGraphId: "graph-123",
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toBe(args)
  })

  test("does nothing when the workspace has no bound graph_id", () => {
    const args = { query: "q" }
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args,
      boundGraphId: undefined,
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toBe(args)
  })

  test("does nothing when this tool has no graph_id parameter at all", () => {
    const args = { skill_id: "abc" }
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args,
      boundGraphId: "graph-123",
      schemaProperties: SCHEMA_WITHOUT_GRAPH_ID,
    })
    expect(result).toBe(args)
  })

  test("does nothing when args is not an object (e.g. malformed tool call)", () => {
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args: "not an object",
      boundGraphId: "graph-123",
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toBe("not an object")
  })

  test("resolves a named secondary graph label to its real graph_id", () => {
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args: { query: "q", graph_id: "frontend" },
      boundGraphId: "graph-primary",
      namedGraphs: [{ label: "frontend", graph_id: "graph-frontend-uuid" }],
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toEqual({ query: "q", graph_id: "graph-frontend-uuid" })
  })

  test("leaves a graph_id that matches no named label untouched", () => {
    const args = { query: "q", graph_id: "some-real-uuid" }
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args,
      boundGraphId: "graph-primary",
      namedGraphs: [{ label: "frontend", graph_id: "graph-frontend-uuid" }],
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toBe(args)
  })

  test("resolves a named label even when the workspace has no primary bound graph", () => {
    const result = fillDocgraphGraphId({
      clientName: "docgraph",
      args: { query: "q", graph_id: "frontend" },
      boundGraphId: undefined,
      namedGraphs: [{ label: "frontend", graph_id: "graph-frontend-uuid" }],
      schemaProperties: SCHEMA_WITH_GRAPH_ID,
    })
    expect(result).toEqual({ query: "q", graph_id: "graph-frontend-uuid" })
  })
})
