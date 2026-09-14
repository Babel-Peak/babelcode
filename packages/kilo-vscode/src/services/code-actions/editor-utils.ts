import * as vscode from "vscode"
import type { FileContext } from "../../kilo-provider/chat-router"

export interface EditorContext {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
  diagnostics: vscode.Diagnostic[]
}

export function getEditorContext(): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return undefined
  const selection = editor.selection
  if (selection.isEmpty) return undefined
  const doc = editor.document
  return {
    filePath: vscode.workspace.asRelativePath(doc.uri),
    selectedText: doc.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    diagnostics: vscode.languages.getDiagnostics(doc.uri).filter((d) => d.range.intersection(selection) !== undefined),
  }
}

/** Context for the active editor: the selection when one exists, else the whole file. */
export function getActiveFileContext(): FileContext | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return undefined
  const doc = editor.document
  if (doc.uri.scheme !== "file" && doc.uri.scheme !== "untitled") return undefined
  const path = vscode.workspace.asRelativePath(doc.uri)
  const selection = editor.selection
  if (!selection.isEmpty) {
    return {
      filePath: path,
      selectedText: doc.getText(selection),
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
    }
  }
  const text = doc.getText()
  return {
    filePath: path,
    selectedText: text,
    startLine: 1,
    endLine: Math.max(1, text.split("\n").length),
  }
}
