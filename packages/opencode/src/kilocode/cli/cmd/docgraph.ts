// kilocode_change - new file
// `kilo docgraph` workspace tools:
//   link [graph_id] [--as <label>]  bind this workspace to a docgraph graph
//                                    -- interactively, if graph_id is omitted
//   create <name> [--ingest]        create a new graph and bind to it
//   ingest [--graph-id <id>]        (re-)ingest this workspace's files
//   status                          show the current binding
//
// Every exported function below takes an explicit `directory` (like the
// original `link()` did) rather than pulling it from ambient state, so each
// is directly testable with a tmpdir + `bootstrap(tmpDir, ...)`, without
// needing a full CLI/yargs invocation -- see test/kilocode/cli/docgraph.test.ts.
//
// Writes reuse the project-config patch mechanism this file has always used
// (KilocodeConfig.updateProjectConfig + patchTopLevelJsonc); the JSONC patch
// path replaces a top-level key wholesale (see patchTopLevelJsonc's own
// docstring), so every write here reads the CURRENT resolved `docgraph`
// block first and writes back the full merged object -- otherwise a second
// write (e.g. `link ... --as`) would silently erase whatever the first one set.
import type { Argv } from "yargs"
import { $ } from "bun"
import { applyEdits, modify } from "jsonc-parser"
import { Effect } from "effect"
import * as prompts from "@clack/prompts"
import type { Config } from "../../../config/config"
import { cmd } from "../../../cli/cmd/cmd"
import { UI } from "../../../cli/ui"
import {
  createGitCredential,
  createGraph as createGraphRemote,
  DocgraphApiError,
  GIT_CREDENTIAL_NEEDED_MARKER,
  ingestGitRepo,
  ingestWorkspaceZip,
  listGraphsRemote,
  type DocgraphGraphSummary,
} from "../../session/docgraph-api"
import { buildWorkspaceZip } from "../../session/workspace-zip"

type DocgraphBinding = NonNullable<Config.Info["docgraph"]>

export const DocgraphCommand = cmd({
  command: "docgraph",
  describe: "docgraph workspace tools",
  builder: (yargs: Argv) =>
    yargs
      .command({
        command: "link [graph_id]",
        describe: "bind this workspace to a docgraph graph (omit graph_id to pick from a list)",
        builder: (y) =>
          y
            .positional("graph_id", { type: "string", describe: "graph UUID; omit to choose interactively" })
            .option("as", {
              type: "string",
              describe: "register as a named secondary graph instead of the primary one",
            }),
        async handler(args) {
          await link({
            graphID: args.graph_id as string | undefined,
            label: args.as as string | undefined,
            directory: process.cwd(),
          })
        },
      })
      .command({
        command: "create <name>",
        describe: "create a new docgraph graph and bind this workspace to it",
        builder: (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("description", { type: "string" })
            .option("ingest", {
              type: "boolean",
              default: false,
              describe: "also ingest this workspace's files into the new graph",
            }),
        async handler(args) {
          await create({
            name: args.name as string,
            description: args.description as string | undefined,
            ingest: Boolean(args.ingest),
            directory: process.cwd(),
          })
        },
      })
      .command({
        command: "ingest",
        describe: "ingest this workspace's files into its bound docgraph graph",
        builder: (y) =>
          y.option("graph-id", {
            type: "string",
            describe: "ingest into this graph instead of the workspace's bound one",
          }),
        async handler(args) {
          await ingest({ graphID: args["graph-id"] as string | undefined, directory: process.cwd() })
        },
      })
      .command({
        command: "status",
        describe: "show this workspace's docgraph graph binding",
        async handler() {
          await status(process.cwd())
        },
      })
      .demandCommand(),
  async handler() {},
})

// ---------------------------------------------------------------------------
// Shared plumbing (mirrors the original link()'s own dynamic-import style)

async function readResolvedConfig(): Promise<Config.Info> {
  const { makeRuntime } = await import("../../../effect/run-service")
  const { Config } = await import("../../../config/config")
  const { AppNodeBuilder } = await import("@opencode-ai/core/effect/app-node-builder")
  const configRt = makeRuntime(Config.Service, AppNodeBuilder.build(Config.node))
  return configRt.runPromise((service) => service.get())
}

async function writeProjectDocgraph(
  ctx: { directory: string; worktree: string },
  update: (current: DocgraphBinding) => DocgraphBinding,
  currentBinding: DocgraphBinding,
): Promise<DocgraphBinding> {
  const { makeRuntime } = await import("../../../effect/run-service")
  const { FSUtil } = await import("@opencode-ai/core/fs-util")
  const { KilocodeConfig } = await import("../../config/config")
  const { ConfigParse } = await import("../../../config/parse")

  const next = update(currentBinding)
  const fsRt = makeRuntime(FSUtil.Service, FSUtil.defaultLayer)
  await fsRt.runPromise((fs) =>
    KilocodeConfig.updateProjectConfig({
      fs,
      directory: ctx.directory,
      worktree: ctx.worktree,
      config: { docgraph: next } as Config.Info,
      read: (file) =>
        fs.readFileString(file).pipe(
          Effect.map((s) => s as string | undefined),
          Effect.catch(() => Effect.succeed<string | undefined>(undefined)),
        ),
      parse: (input, file) => ConfigParse.jsonc(input, file) as Config.Info,
      patch: patchTopLevelJsonc,
      writable: (c) => c,
    }),
  )
  return next
}

function upsertLabel(binding: DocgraphBinding, label: string, graphID: string): DocgraphBinding {
  const graphs = (binding.graphs ?? []).filter((entry) => entry.label !== label)
  graphs.push({ label, graph_id: graphID })
  return { ...binding, graphs }
}

/** Exported so the interactive-selection UX itself is unit-testable with a
 * fake list and a mocked @clack/prompts.select, without needing the network
 * call or the full CLI. */
export async function pickGraphInteractively(graphs: DocgraphGraphSummary[]): Promise<string> {
  if (graphs.length === 0) {
    throw new Error("No graphs found on this docgraph deployment. Create one first with `kilo docgraph create <name>`.")
  }
  const selected = await prompts.select({
    message: "Pick a docgraph graph to link this workspace to",
    options: graphs.map((graph) => ({
      value: graph.id,
      label: graph.name,
      hint: `${graph.doc_count} doc${graph.doc_count === 1 ? "" : "s"}`,
    })),
  })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  return selected
}

// An SSH remote (git@host:org/repo.git) is what most local checkouts have,
// but docgraph's server-side clone authenticates over HTTPS with a stored
// token (see GitAuth in code_ingest.py) -- there's no SSH key to hand it, so
// SSH remotes are normalized to their HTTPS equivalent before being sent.
export function normalizeGitRemoteUrl(url: string): string {
  const sshMatch = url.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/)
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}.git`
  return url
}

export function gitRemoteHost(url: string): string {
  return new URL(normalizeGitRemoteUrl(url)).host
}

async function detectGitRemoteUrl(directory: string): Promise<string | null> {
  try {
    const url = (await $`git remote get-url origin`.cwd(directory).quiet().text()).trim()
    return url || null
  } catch {
    return null
  }
}

async function currentGitBranch(directory: string): Promise<string | undefined> {
  try {
    const branch = (await $`git branch --show-current`.cwd(directory).quiet().text()).trim()
    return branch || undefined
  } catch {
    return undefined
  }
}

async function promptForGitCredential(
  remoteUrl: string,
  apiConfig: Config.Info["docgraph_api"],
): Promise<string> {
  UI.println(`${remoteUrl} needs credentials to clone -- registering one with docgraph now.`)
  const username = await prompts.text({
    message: "Git username (leave blank to authenticate with the token alone)",
  })
  if (prompts.isCancel(username)) throw new UI.CancelledError()
  const token = await prompts.password({ message: "Personal access token (read access to the repo)" })
  if (prompts.isCancel(token)) throw new UI.CancelledError()

  const host = gitRemoteHost(remoteUrl)
  const credential = await createGitCredential(apiConfig, {
    name: `${host}-${Date.now()}`,
    host,
    token,
    username: username || undefined,
  })
  return credential.id
}

async function ingestGitRemote(
  directory: string,
  graphID: string,
  remoteUrl: string,
  apiConfig: Config.Info["docgraph_api"],
): Promise<void> {
  const branch = await currentGitBranch(directory)
  const normalized = normalizeGitRemoteUrl(remoteUrl)
  UI.println(`Ingesting ${normalized}${branch ? ` (${branch})` : ""} via docgraph's git-based ingest ...`)
  try {
    const result = await ingestGitRepo(apiConfig, { graphId: graphID, remoteUrl: normalized, branch })
    UI.println(`Queued ${result.queued} file(s) for ingest (batch ${result.batch_id}).`)
  } catch (err) {
    if (!(err instanceof DocgraphApiError) || !err.message.includes(GIT_CREDENTIAL_NEEDED_MARKER)) throw err
    const credentialId = await promptForGitCredential(normalized, apiConfig)
    const result = await ingestGitRepo(apiConfig, { graphId: graphID, remoteUrl: normalized, branch, credentialId })
    UI.println(`Queued ${result.queued} file(s) for ingest (batch ${result.batch_id}).`)
  }
}

// Prefers docgraph's git-based ingest whenever the workspace has a git
// remote -- it clones server-side with no size cap, unlike the zip-upload
// path below, which stays as the fallback for a workspace with no remote
// (e.g. a scratch directory) rather than being the default.
async function ingestDirectory(directory: string, graphID: string, apiConfig: Config.Info["docgraph_api"]): Promise<void> {
  const remoteUrl = await detectGitRemoteUrl(directory)
  if (remoteUrl) {
    await ingestGitRemote(directory, graphID, remoteUrl, apiConfig)
    return
  }
  UI.println(`Zipping ${directory} ...`)
  const zipBytes = await buildWorkspaceZip(directory)
  UI.println(`Uploading to docgraph (${(zipBytes.byteLength / (1024 * 1024)).toFixed(1)} MB) ...`)
  const result = await ingestWorkspaceZip(apiConfig, { graphId: graphID, zipBytes, zipFilename: "workspace.zip" })
  UI.println(`Queued ${result.queued} file(s) for ingest (batch ${result.batch_id}).`)
}

// ---------------------------------------------------------------------------
// Commands

export async function link(input: { graphID?: string; label?: string; directory: string }): Promise<void> {
  const { bootstrap } = await import("../../../cli/bootstrap")
  const { context } = await import("../../../project/instance-context")

  await bootstrap(input.directory, async () => {
    const ctx = context.use()
    const cfg = await readResolvedConfig()
    const graphID = input.graphID ?? (await pickGraphInteractively(await listGraphsRemote(cfg.docgraph_api)))
    await writeProjectDocgraph(
      ctx,
      (current) => (input.label ? upsertLabel(current, input.label, graphID) : { ...current, graph_id: graphID }),
      cfg.docgraph ?? {},
    )
    UI.println(
      input.label
        ? `Linked this workspace's "${input.label}" graph to ${graphID}.`
        : `Linked this workspace to docgraph graph ${graphID}.`,
    )
  })
}

export async function create(input: {
  name: string
  description?: string
  ingest: boolean
  directory: string
}): Promise<void> {
  const { bootstrap } = await import("../../../cli/bootstrap")
  const { context } = await import("../../../project/instance-context")

  await bootstrap(input.directory, async () => {
    const ctx = context.use()
    const cfg = await readResolvedConfig()
    const graph = await createGraphRemote(cfg.docgraph_api, { name: input.name, description: input.description })
    await writeProjectDocgraph(ctx, (current) => ({ ...current, graph_id: graph.id }), cfg.docgraph ?? {})
    UI.println(`Created docgraph graph "${graph.name}" (${graph.id}) and linked this workspace to it.`)
    if (input.ingest) await ingestDirectory(ctx.directory, graph.id, cfg.docgraph_api)
  })
}

export async function ingest(input: { graphID?: string; directory: string }): Promise<void> {
  const { bootstrap } = await import("../../../cli/bootstrap")
  const { context } = await import("../../../project/instance-context")

  await bootstrap(input.directory, async () => {
    const ctx = context.use()
    const cfg = await readResolvedConfig()
    const graphID = input.graphID ?? cfg.docgraph?.graph_id
    if (!graphID) {
      throw new Error(
        "This workspace has no bound graph. Run `kilo docgraph link <graph_id>` or `kilo docgraph create <name>` first, or pass --graph-id.",
      )
    }
    await ingestDirectory(ctx.directory, graphID, cfg.docgraph_api)
  })
}

export async function status(directory: string): Promise<void> {
  const { bootstrap } = await import("../../../cli/bootstrap")
  const { context } = await import("../../../project/instance-context")

  await bootstrap(directory, async () => {
    const ctx = context.use()
    const cfg = await readResolvedConfig()
    const binding = cfg.docgraph
    UI.println(`Directory: ${ctx.directory}`)
    UI.println(`Primary graph: ${binding?.graph_id ?? "(none)"}`)
    if (binding?.graphs?.length) {
      UI.println("Named graphs:")
      for (const entry of binding.graphs) UI.println(`  ${entry.label} -> ${entry.graph_id}`)
    } else {
      UI.println("Named graphs: (none)")
    }
  })
}

/** Minimal top-level-key JSONC patcher -- see kilocode/snapshot/track.ts's
 * identical helper for why this isn't shared with config/config.ts's
 * internal (unexported) patchJsonc: nested values are replaced wholesale,
 * which is exactly right for a single `{ docgraph: {...} }` patch as long as
 * the caller (writeProjectDocgraph above) already merged in the current
 * value -- see this function's own usage there. */
export function patchTopLevelJsonc(input: string, patch: Record<string, unknown>): string {
  return Object.entries(patch).reduce((out, [key, value]) => {
    if (value === undefined) return out
    const edits = modify(out, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
    return applyEdits(out, edits)
  }, input)
}
