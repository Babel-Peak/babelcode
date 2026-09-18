// kilocode_change - new file
// Plain HTTP client for docgraph's own workspace-management API: create a
// graph, ingest a zipped workspace into it, list graphs (for `kilo docgraph
// create`/`ingest`/`link`'s interactive picker). Deliberately NOT
// best-effort like docgraph-cost.ts's fetch: these are explicit,
// user-initiated actions, so a failure must surface as a clear error the CLI
// can print, not be silently swallowed.
//
// Uses the docgraph_api config block (url + api_key), not docgraph_events --
// that credential is scoped to telemetry forwarding only (agent:events);
// this one needs graph:write (or kb:admin) to create graphs and trigger
// ingest, so reusing docgraph_events here would mix scopes that the schema
// deliberately keeps separate.
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "docgraph-api" })

export interface DocgraphApiConfig {
  url?: string
  api_key?: string
}

export class DocgraphApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DocgraphApiError"
  }
}

export const MISSING_CONFIG_MESSAGE =
  "docgraph_api.url and docgraph_api.api_key are not configured. Set them in the global " +
  "config (~/.config/kilo/kilo.jsonc) with a credential that has the graph:write scope (or kb:admin)."

function resolvedConfig(config: DocgraphApiConfig | undefined): { url: string; apiKey: string } {
  if (!config?.url || !config.api_key) throw new DocgraphApiError(MISSING_CONFIG_MESSAGE)
  return { url: config.url.replace(/\/+$/, ""), apiKey: config.api_key }
}

async function request(
  config: DocgraphApiConfig | undefined,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const { url, apiKey } = resolvedConfig(config)
  let response: Response
  try {
    response = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), "X-API-Key": apiKey },
    })
  } catch (error) {
    log.warn("docgraph API request failed", { path, error: String(error) })
    throw new DocgraphApiError(`could not reach docgraph at ${url}: ${String(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new DocgraphApiError(
      `docgraph request to ${path} failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    )
  }
  return response
}

export interface DocgraphGraphSummary {
  id: string
  name: string
  description: string | null
  doc_count: number
}

export async function listGraphsRemote(config: DocgraphApiConfig | undefined): Promise<DocgraphGraphSummary[]> {
  const response = await request(config, "/graphs")
  return (await response.json()) as DocgraphGraphSummary[]
}

export async function createGraph(
  config: DocgraphApiConfig | undefined,
  input: { name: string; description?: string },
): Promise<DocgraphGraphSummary> {
  const response = await request(config, "/graphs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, description: input.description }),
  })
  return (await response.json()) as DocgraphGraphSummary
}

export interface IngestResult {
  batch_id: string
  repo_id: string
  repo_ids: string[]
  queued: number
  files: string[]
}

export async function ingestWorkspaceZip(
  config: DocgraphApiConfig | undefined,
  input: { graphId: string; zipBytes: Uint8Array; zipFilename: string },
): Promise<IngestResult> {
  const form = new FormData()
  form.set("graph_id", input.graphId)
  // Node's Blob accepts a Uint8Array at runtime; the DOM lib's BlobPart type
  // here is stricter than that (rejects the generic ArrayBufferLike backing
  // a typed array, only a concrete ArrayBuffer) -- a real type-vs-runtime
  // mismatch, not an actual unsafe cast.
  form.set("repo_archives", new Blob([input.zipBytes as unknown as BlobPart]), input.zipFilename)
  const response = await request(config, "/ingest", { method: "POST", body: form })
  return (await response.json()) as IngestResult
}

// Server-side git clone bypasses the CLI's zip-upload path entirely (see
// docgraph's services/code_ingest.py::create_repository_batch), so it has no
// workspace-size cap -- the right choice whenever the workspace is a git
// checkout, not just when it's too big to zip.
export async function ingestGitRepo(
  config: DocgraphApiConfig | undefined,
  input: { graphId: string; remoteUrl: string; branch?: string; credentialId?: string },
): Promise<IngestResult> {
  const response = await request(config, "/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graph_id: input.graphId,
      repo: { kind: "git_url", value: input.remoteUrl, branch: input.branch, credential_id: input.credentialId },
    }),
  })
  return (await response.json()) as IngestResult
}

// Substring docgraph's own code_ingest.py raises verbatim (ValueError(
// "repository clone failed; no configured credential was accepted")) when a
// git_url repo needs auth and none of the tenant's existing credentials
// work -- matched against the HTTP error body text so the CLI can tell
// "needs a credential" apart from every other ingest failure and only then
// prompt for one.
export const GIT_CREDENTIAL_NEEDED_MARKER = "no configured credential was accepted"

export interface GitCredentialSummary {
  id: string
  name: string
  provider: string
  host: string
}

export async function createGitCredential(
  config: DocgraphApiConfig | undefined,
  input: { name: string; host: string; token: string; username?: string },
): Promise<GitCredentialSummary> {
  const response = await request(config, "/git-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, host: input.host, token: input.token, username: input.username }),
  })
  return (await response.json()) as GitCredentialSummary
}
