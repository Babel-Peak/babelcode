// kilocode_change - new file
// Pure helper for session/tools.ts's MCP tool-execute path: fill in a
// docgraph tool's graph_id argument from this workspace's binding
// (`kilo docgraph link`, config/config.ts's `docgraph.graph_id`) when the
// model omitted it, so the model no longer has to guess/know the graph_id
// itself. Kept pure and separate from the Effect-heavy call site so it's
// unit-testable without the full tool-execution scaffolding.
//
// Also resolves a named secondary graph (`kilo docgraph link <id> --as
// <label>`, config/config.ts's `docgraph.graphs`): a multi-root workspace's
// primary binding covers only one graph, so when the model supplies one of
// these labels in place of a real graph_id -- it can see the labels via
// session/tools.ts's tool-description note -- resolve it to the real UUID
// before the MCP call is dispatched.
import { isRecord } from "@/util/record"

export function fillDocgraphGraphId(input: {
  clientName: string
  args: unknown
  boundGraphId: string | undefined
  namedGraphs?: { label: string; graph_id: string }[]
  schemaProperties: Record<string, unknown> | undefined
}): unknown {
  if (input.clientName !== "docgraph") return input.args
  if (!isRecord(input.args)) return input.args
  if (!input.schemaProperties || !("graph_id" in input.schemaProperties)) return input.args

  const supplied = input.args.graph_id
  if (typeof supplied === "string" && supplied) {
    const match = input.namedGraphs?.find((entry) => entry.label === supplied)
    return match ? { ...input.args, graph_id: match.graph_id } : input.args
  }

  if (!input.boundGraphId) return input.args
  return { ...input.args, graph_id: input.boundGraphId }
}
