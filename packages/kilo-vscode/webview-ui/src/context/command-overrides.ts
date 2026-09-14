import type { ModelSelection } from "../types/messages"

export interface CommandOverrides {
  agent?: string
  model?: string
  variant?: string
}

type Deps = {
  selectAgent: (name: string, sessionID?: string) => void
  resetVariant: (sessionID?: string) => void
  selectModel: (providerID: string, modelID: string, sessionID?: string) => void
  selectVariant: (value: string | undefined, sessionID?: string) => void
  parseModel: (value: string | undefined) => ModelSelection | null
}

/** Apply a slash command's agent/model/variant overrides before sending.
 * Without an explicit variant override, the new mode's configured default
 * reasoning applies instead of the session-scoped choice. */
export function applyCommandOverrides(overrides: CommandOverrides | undefined, scope: string | undefined, deps: Deps) {
  if (!overrides) return
  if (overrides.agent) {
    deps.selectAgent(overrides.agent, scope)
    if (!overrides.variant) deps.resetVariant(scope)
  }
  if (overrides.model) {
    const parsed = deps.parseModel(overrides.model)
    if (parsed) deps.selectModel(parsed.providerID, parsed.modelID, scope)
  }
  if (overrides.variant) deps.selectVariant(overrides.variant, scope)
}
