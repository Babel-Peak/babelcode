// kilocode_change - new file
import { describe, expect, test, mock, afterEach } from "bun:test"
import {
  DocgraphApiError,
  MISSING_CONFIG_MESSAGE,
  createGraph,
  ingestWorkspaceZip,
  listGraphsRemote,
} from "../../../src/kilocode/session/docgraph-api"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("docgraph-api", () => {
  test("listGraphsRemote throws a clear error when unconfigured", async () => {
    await expect(listGraphsRemote(undefined)).rejects.toThrow(MISSING_CONFIG_MESSAGE)
    await expect(listGraphsRemote({ url: "https://api.example.com" })).rejects.toThrow(MISSING_CONFIG_MESSAGE)
    await expect(listGraphsRemote({ api_key: "k" })).rejects.toThrow(MISSING_CONFIG_MESSAGE)
  })

  test("listGraphsRemote fetches GET /graphs with the api key header", async () => {
    let seenUrl: string | undefined
    let seenHeaders: HeadersInit | undefined
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(input)
      seenHeaders = init?.headers
      return new Response(JSON.stringify([{ id: "g1", name: "Repo", description: null, doc_count: 3 }]), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const graphs = await listGraphsRemote({ url: "https://api.example.com/", api_key: "the-key" })

    expect(seenUrl).toBe("https://api.example.com/graphs")
    expect(new Headers(seenHeaders).get("X-API-Key")).toBe("the-key")
    expect(graphs).toEqual([{ id: "g1", name: "Repo", description: null, doc_count: 3 }])
  })

  test("createGraph POSTs to /graphs with the payload", async () => {
    let seenBody: string | undefined
    let seenMethod: string | undefined
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      seenMethod = init?.method
      seenBody = String(init?.body)
      return new Response(JSON.stringify({ id: "g2", name: "New graph", description: "d", doc_count: 0 }), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const graph = await createGraph(
      { url: "https://api.example.com", api_key: "k" },
      { name: "New graph", description: "d" },
    )

    expect(seenMethod).toBe("POST")
    expect(JSON.parse(seenBody!)).toEqual({ name: "New graph", description: "d" })
    expect(graph.id).toBe("g2")
  })

  test("ingestWorkspaceZip POSTs multipart form with graph_id and repo_archives", async () => {
    let seenForm: FormData | undefined
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      seenForm = init?.body as FormData
      return new Response(
        JSON.stringify({ batch_id: "b1", repo_id: "r1", repo_ids: ["r1"], queued: 2, files: ["a.zip"] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const result = await ingestWorkspaceZip(
      { url: "https://api.example.com", api_key: "k" },
      { graphId: "g1", zipBytes: new Uint8Array([1, 2, 3]), zipFilename: "workspace.zip" },
    )

    expect(seenForm).toBeInstanceOf(FormData)
    expect(seenForm!.get("graph_id")).toBe("g1")
    const archive = seenForm!.get("repo_archives") as File
    expect(archive.name).toBe("workspace.zip")
    expect(result.batch_id).toBe("b1")
    expect(result.queued).toBe(2)
  })

  test("throws a DocgraphApiError with status on a non-ok response", async () => {
    globalThis.fetch = mock(async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch

    await expect(createGraph({ url: "https://api.example.com", api_key: "k" }, { name: "x" })).rejects.toThrow(
      DocgraphApiError,
    )
  })

  test("throws a DocgraphApiError when the network request itself fails", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    await expect(listGraphsRemote({ url: "https://api.example.com", api_key: "k" })).rejects.toThrow(
      DocgraphApiError,
    )
  })
})
