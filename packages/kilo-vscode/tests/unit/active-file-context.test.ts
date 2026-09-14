import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { getActiveFileContext } from "../../src/services/code-actions/editor-utils"

type Api = typeof vscode & { window: { activeTextEditor?: unknown } }
const api = vscode as Api
const original = api.window.activeTextEditor

const editor = (
  uri: { scheme: string; fsPath: string },
  selection: { isEmpty: boolean },
  getText: (range?: unknown) => string,
) => ({
  selection,
  document: { uri, getText },
})

afterEach(() => {
  api.window.activeTextEditor = original
})

describe("getActiveFileContext", () => {
  it("returns the selection when one exists", () => {
    api.window.activeTextEditor = editor(
      vscode.Uri.file("/repo/src/file.ts"),
      { isEmpty: false, start: { line: 2 }, end: { line: 4 } },
      (range) => (range ? "selected" : "whole"),
    )

    expect(getActiveFileContext()).toEqual({
      filePath: "src/file.ts",
      selectedText: "selected",
      startLine: 3,
      endLine: 5,
    })
  })

  it("returns the whole file when the selection is empty", () => {
    api.window.activeTextEditor = editor(
      vscode.Uri.file("/repo/src/file.ts"),
      { isEmpty: true },
      () => "line 1\nline 2\nline 3",
    )

    expect(getActiveFileContext()).toEqual({
      filePath: "src/file.ts",
      selectedText: "line 1\nline 2\nline 3",
      startLine: 1,
      endLine: 3,
    })
  })

  it("returns undefined without an active editor", () => {
    api.window.activeTextEditor = undefined

    expect(getActiveFileContext()).toBeUndefined()
  })

  it("returns undefined for non-file documents", () => {
    api.window.activeTextEditor = editor({ scheme: "output", fsPath: "/tmp/output" }, { isEmpty: true }, () => "")

    expect(getActiveFileContext()).toBeUndefined()
  })
})
