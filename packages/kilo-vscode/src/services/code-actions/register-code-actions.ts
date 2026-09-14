import * as vscode from "vscode"
import type { KiloProvider } from "../../KiloProvider"
import type { AgentManagerProvider } from "../../agent-manager/AgentManagerProvider"
import { getEditorContext } from "./editor-utils"
import { createPrompt } from "./support-prompt"

export function registerCodeActions(
  context: vscode.ExtensionContext,
  provider: KiloProvider,
  agentManager?: AgentManagerProvider,
  activeTabProvider?: () => KiloProvider | undefined,
): void {
  const target = () => (agentManager?.isActive() ? agentManager : (activeTabProvider?.() ?? provider))
  const reveal = async () => {
    await vscode.commands.executeCommand("babel-code.SidebarProvider.focus")
    await provider.waitForReady()
  }
  // Only the sidebar `provider` branch used to await readiness before
  // posting. An editor-tab webview or the Agent Manager panel can still be
  // opening/restoring when one of these commands fires, and postMessage()
  // does not queue — it silently drops the message if the webview hasn't
  // installed its listener yet. Wait for the selected target's own
  // readiness too before posting to it.
  //
  // AgentManagerProvider.waitForReady() resolves `false` instead of hanging
  // forever when the selected panel closes or is replaced while waiting.
  // Propagate that so callers skip posting instead of delivering the
  // message to whatever panel happens to be active by the time the wait
  // settles.
  const revealTarget = async (view: KiloProvider | AgentManagerProvider): Promise<boolean> => {
    if (view === provider) {
      await reveal()
      return true
    }
    if (view === agentManager) {
      return agentManager.waitForReady()
    }
    await view.waitForReady()
    return true
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("babel-code.new.explainCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("EXPLAIN", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        userInput: "",
      })
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("babel-code.new.fixCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("FIX", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        diagnostics: ctx.diagnostics,
        userInput: "",
      })
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("babel-code.new.improveCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("IMPROVE", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        userInput: "",
      })
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("babel-code.new.addToContext", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({
        type: "addCodeContext",
        filePath: ctx.filePath,
        startLine: ctx.startLine,
        endLine: ctx.endLine,
        selectedText: ctx.selectedText,
      })
    }),

    vscode.commands.registerCommand(
      "babel-code.new.addFileToContext",
      async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const list = uris && uris.length > 0 ? uris : uri ? [uri] : []
        if (list.length === 0) return
        const view = target()
        if (!(await revealTarget(view))) return
        const root = vscode.workspace.workspaceFolders?.[0]?.uri

        for (const u of list) {
          const rel = root ? vscode.workspace.asRelativePath(u, false) : u.fsPath
          try {
            const stat = await vscode.workspace.fs.stat(u)
            if ((stat.type & vscode.FileType.Directory) !== 0) {
              view.postMessage({ type: "appendChatBoxMessage", text: `@${rel} ` })
              continue
            }
            const bytes = await vscode.workspace.fs.readFile(u)
            const text = new TextDecoder().decode(bytes)
            const lines = text.split("\n").length
            view.postMessage({
              type: "addCodeContext",
              filePath: rel,
              startLine: 1,
              endLine: Math.max(1, lines),
              selectedText: text,
            })
          } catch {
            view.postMessage({ type: "appendChatBoxMessage", text: `@${rel} ` })
          }
        }
      },
    ),

    vscode.commands.registerCommand("babel-code.new.focusChatInput", async () => {
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "action", action: "focusInput" })
    }),

    // Command Palette only — no keybinding. A keybinding would need to
    // route through VS Code's keybinding-to-focused-webview forwarding,
    // which doesn't reliably reach a webview whose own input already has
    // focus; invoking straight from the palette sidesteps that path
    // entirely, the same way terminalAddToContext etc. do. Toggles: the
    // webview closes the search bar itself if it's already open.
    vscode.commands.registerCommand("babel-code.new.toggleChatSearch", async () => {
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "action", action: "focusSearch" })
    }),
  )
}
