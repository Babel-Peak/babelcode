export const KILO_PROVIDER_ID = "kilo"
// Default/fallback model selection. Kilo Gateway is hidden from the picker,
// so the fallback routes through OpenRouter's built-in "Auto Router" model.
export const KILO_AUTO = { providerID: "openrouter", modelID: "auto" } as const
export const CUSTOM_PROVIDER_PACKAGES = ["@ai-sdk/openai-compatible", "@ai-sdk/openai", "@ai-sdk/anthropic"] as const
export type CustomProviderPackage = (typeof CUSTOM_PROVIDER_PACKAGES)[number]
export const CUSTOM_PROVIDER_PACKAGE: CustomProviderPackage = "@ai-sdk/openai-compatible"
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/

// Legacy/static fallback for provider objects created before backend metadata is available.
export const PROVIDER_PRIORITY = [
  KILO_PROVIDER_ID,
  "anthropic",
  "deepseek",
  "openai",
  "google",
  "openrouter",
  "vercel",
] as const

export function isCustomProviderPackage(value: unknown): value is CustomProviderPackage {
  return CUSTOM_PROVIDER_PACKAGES.includes(value as CustomProviderPackage)
}

export function isKiloAuto(sel: { providerID: string; modelID: string }): boolean {
  return sel.providerID === KILO_AUTO.providerID && sel.modelID === KILO_AUTO.modelID
}

export function parseModelString(raw: string | undefined | null) {
  if (!raw) return null
  const slash = raw.indexOf("/")
  if (slash <= 0 || slash >= raw.length - 1) return null
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

export function providerOrderIndex(providerID: string, order = PROVIDER_PRIORITY) {
  const index = order.indexOf(providerID.toLowerCase() as (typeof PROVIDER_PRIORITY)[number])
  return index >= 0 ? index : order.length
}

export function createKiloFallbackProvider() {
  return {
    id: KILO_PROVIDER_ID,
    name: "Kilo Gateway",
    source: "custom" as const,
    env: ["KILO_API_KEY"],
    metadata: {
      noteKey: "settings.providers.note.kilo",
      icon: KILO_PROVIDER_ID,
      priority: 0,
    },
    models: {},
  }
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  vercel: "Vercel AI Gateway",
}

export function createProviderFallbacks(providers: Record<string, unknown>) {
  return Object.fromEntries(
    PROVIDER_PRIORITY.filter((id) => id !== KILO_PROVIDER_ID && !providers[id]).map((id) => [
      id,
      {
        id,
        name: PROVIDER_NAMES[id] ?? id,
        source: "custom" as const,
        models: {},
      },
    ]),
  )
}
