# Docgraph: Finding and Creating Graphs for a Workspace

Docgraph's MCP server (`search_knowledge`, `search_symbols`, `list_graphs`, etc.) is **read-only** by design — it never creates a graph or ingests a repo. There is no MCP tool for this. Do not keep probing MCP resources/tools looking for one; go straight to the CLI steps below.

## 1. Check whether this workspace is already ingested

Call the MCP `list_graphs` tool and look for a `repository_names` entry matching this repo's name (from `git remote get-url origin`, e.g. `org/repo.git` -> `repo`). If a match exists, that graph is very likely already relevant to this workspace.

Also check the local binding, since a workspace already linked to a graph should reuse it rather than creating a duplicate:

```
kilo docgraph status
```

## 2. Creating and ingesting a new graph

If no existing graph covers this repo, **stop and ask the user before creating one** — this both creates a new tenant-visible graph and re-embeds the whole repo, which costs real money (LLM embedding + summary calls scale with repo size; a large repo can be several dollars). Confirm the intended graph name and whether they want a new graph or to link into an existing one first.

Once confirmed, this is a plain CLI action (a `bash` tool call), never an MCP call:

```
kilo docgraph create "<name>" --ingest
```

Run this from the repository's root directory. It binds the workspace to the new graph and ingests it in one step. To bind to an existing graph instead and ingest into that:

```
kilo docgraph link <graph_id>
kilo docgraph ingest
```

`ingest` auto-detects the workspace's git remote and ingests via docgraph's server-side git clone (no size limit) rather than zipping the workspace — this is automatic, nothing to configure. If the remote needs credentials to clone (a private repo), it will interactively prompt for a username and personal access token and register them with docgraph itself; just relay that prompt to the user if it needs their input.

## 3. Locating the `kilo` binary

`kilo` is the CLI bundled inside this VS Code extension and is **not** on `$PATH` by default. If a bare `kilo` command is not found, locate the bundled binary and use its full path:

```
find ~/.vscode/extensions -maxdepth 2 -ipath "*/bin/kilo" 2>/dev/null | head -1
```

## 4. Configuration this depends on

`kilo docgraph create/link/ingest` needs a `docgraph_api` block (`url` + a `graph:write`-scoped `api_key`) in the global config (`~/.config/kilo/kilo.jsonc`) — a different credential from the `mcp.docgraph` entry used for read-only MCP calls. If a `docgraph create`/`ingest` call fails with a config-missing error, tell the user exactly that (which config key, which scope) rather than retrying blindly.
