// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import KILO_CONFIG from "./kilo-config.md" with { type: "text" }
import DOCGRAPH_INGEST from "./docgraph-ingest.md" with { type: "text" }

export interface BuiltinSkill {
  name: string
  description: string
  content: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Guide for Kilo configuration: config paths, kilo.json fields, commands, agents, skills, permissions, MCPs, providers, TUI settings, plus Agent Manager worktree setup/run scripts, workflows, and state. Use for Kilo config questions, locating loaded config, changing settings, or Agent Manager questions about run/setup scripts, worktree setup/workflows, apply/merge/PR/conflicts, missing sessions/worktrees, and agent-manager.json recovery.",
    content: KILO_CONFIG,
  },
  {
    name: "docgraph-ingest",
    description:
      "How to find or create a docgraph graph for the current workspace and ingest a repository into it. Use whenever a docgraph MCP tool (search_knowledge, list_graphs, etc.) doesn't find relevant content for this repo, or the user asks to embed/ingest/index a repo into docgraph/Cruxible. Creating and ingesting a graph is a `kilo docgraph` CLI action, never an MCP tool -- this skill explains the exact commands and the confirm-with-the-user-first step.",
    content: DOCGRAPH_INGEST,
  },
]
