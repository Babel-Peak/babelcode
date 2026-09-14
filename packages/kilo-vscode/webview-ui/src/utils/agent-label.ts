import type { AgentInfo } from "../types/messages"

/** Title-case an agent slug, e.g. "code" -> "Code", "plan-architect" -> "Plan Architect". */
export function titleCaseAgentName(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Format an agent for display. Uses displayName if available, otherwise title-cases the slug. */
export function formatAgentLabel(agent: AgentInfo): string {
  if (agent.displayName) return agent.displayName
  return titleCaseAgentName(agent.name)
}
