import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerCodeActions } from "../../src/services/code-actions/register-code-actions"

type Command = (...args: unknown[]) => unknown

type Api = typeof vscode & {
  commands: {
    registerCommand: (command: string, callback: Command) => { dispose(): void }
    executeCommand: (...args: unknown[]) => Promise<void>
  }
  languages: {
    getDiagnostics: () => Array<{ range: { intersection: () => unknown } }>
  }
  window: typeof vscode.window & { activeTextEditor?: unknown }
}

const api = vscode as Api
const original = {
  register: api.commands.registerCommand,
  execute: api.commands.executeCommand,
  editor: api.window.activeTextEditor,
  diagnostics: api.languages.getDiagnostics,
  fs: api.workspace.fs,
}

function setup(active = false, agentReady = true) {
  const commands = new Map<string, Command>()
  const executed: unknown[][] = []
  const events: string[] = []
  const posts: unknown[] = []
  const waits: string[] = []
  const context = { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
  const provider = {
    postMessage: (msg: unknown) => {
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("provider")
    },
  }
  const agent = {
    isActive: () => active,
    postMessage: (msg: unknown) => {
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("agent")
      return agentReady
    },
  }

  api.commands.registerCommand = (command, callback) => {
    commands.set(command, callback)
    return { dispose: () => undefined }
  }
  api.commands.executeCommand = async (...args) => {
    events.push("focus")
    executed.push(args)
  }
  api.languages.getDiagnostics = () => []
  api.workspace.fs = {
    ...original.fs,
    stat: async () => ({ type: vscode.FileType.File }) as never,
    readFile: async () => new TextEncoder().encode("line 1\nline 2\nline 3"),
  } as never
  api.window.activeTextEditor = {
    selection: {
      isEmpty: false,
      start: { line: 2 },
      end: { line: 4 },
    },
    document: {
      uri: vscode.Uri.file("/repo/src/file.ts"),
      getText: () => "const value = 1",
    },
  }

  registerCodeActions(context, provider as never, agent as never)

  return { commands, events, executed, posts, waits }
}

afterEach(() => {
  api.commands.registerCommand = original.register
  api.commands.executeCommand = original.execute
  api.window.activeTextEditor = original.editor
  api.languages.getDiagnostics = original.diagnostics
  api.workspace.fs = original.fs
})

describe("registerCodeActions", () => {
  it("reveals the sidebar before adding selected code to context", async () => {
    const state = setup()

    await state.commands.get("babel-code.new.addToContext")?.()

    expect(state.events).toEqual(["focus", "wait", "post"])
    expect(state.executed).toEqual([["babel-code.SidebarProvider.focus"]])
    expect(state.waits).toEqual(["provider"])
    expect(state.posts).toEqual([
      {
        type: "addCodeContext",
        filePath: "src/file.ts",
        startLine: 3,
        endLine: 5,
        selectedText: "const value = 1",
      },
    ])
  })

  it("adds selected code to the active Agent Manager without revealing the sidebar", async () => {
    const state = setup(true)

    await state.commands.get("babel-code.new.addToContext")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.executed).toEqual([])
    expect(state.waits).toEqual(["agent"])
    expect(state.posts).toEqual([
      {
        type: "addCodeContext",
        filePath: "src/file.ts",
        startLine: 3,
        endLine: 5,
        selectedText: "const value = 1",
      },
    ])
  })

  it("does not post to the Agent Manager when its readiness wait is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("babel-code.new.addToContext")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })

  it("toggles chat search on the active Agent Manager once it is ready", async () => {
    const state = setup(true)

    await state.commands.get("babel-code.new.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.posts).toEqual([{ type: "action", action: "focusSearch" }])
  })

  it("does not toggle chat search when Agent Manager readiness is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("babel-code.new.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })

  it("adds a single file to context via addFileToContext", async () => {
    const state = setup()
    const uri = vscode.Uri.file("/repo/src/file.ts")

    await state.commands.get("babel-code.new.addFileToContext")?.(uri)

    expect(state.events).toEqual(["focus", "wait", "post"])
    expect(state.posts).toEqual([
      {
        type: "addCodeContext",
        filePath: "src/file.ts",
        startLine: 1,
        endLine: 3,
        selectedText: "line 1\nline 2\nline 3",
      },
    ])
  })

  it("adds multiple selected files to context via addFileToContext", async () => {
    const state = setup()
    const uri1 = vscode.Uri.file("/repo/src/file1.ts")
    const uri2 = vscode.Uri.file("/repo/src/file2.ts")

    await state.commands.get("babel-code.new.addFileToContext")?.(uri1, [uri1, uri2])

    expect(state.posts).toEqual([
      {
        type: "addCodeContext",
        filePath: "src/file1.ts",
        startLine: 1,
        endLine: 3,
        selectedText: "line 1\nline 2\nline 3",
      },
      {
        type: "addCodeContext",
        filePath: "src/file2.ts",
        startLine: 1,
        endLine: 3,
        selectedText: "line 1\nline 2\nline 3",
      },
    ])
  })

  it("falls back to text mention when adding a directory via addFileToContext", async () => {
    const state = setup()
    api.workspace.fs.stat = (async () => ({ type: vscode.FileType.Directory })) as never
    const uri = vscode.Uri.file("/repo/src/dir")

    await state.commands.get("babel-code.new.addFileToContext")?.(uri)

    expect(state.posts).toEqual([
      {
        type: "appendChatBoxMessage",
        text: "@src/dir ",
      },
    ])
  })
})
