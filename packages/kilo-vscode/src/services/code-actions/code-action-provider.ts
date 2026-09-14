import * as vscode from "vscode"

export class KiloCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (range.isEmpty) return []

    const actions: vscode.CodeAction[] = []

    const add = new vscode.CodeAction("Add to Babel Code", vscode.CodeActionKind.RefactorRewrite)
    add.command = { command: "babel-code.new.addToContext", title: "Add to Babel Code" }
    actions.push(add)

    const hasDiagnostics = context.diagnostics.length > 0

    if (hasDiagnostics) {
      const fix = new vscode.CodeAction("Fix with Babel Code", vscode.CodeActionKind.QuickFix)
      fix.command = { command: "babel-code.new.fixCode", title: "Fix with Babel Code" }
      fix.isPreferred = true
      actions.push(fix)
    }

    if (!hasDiagnostics) {
      const explain = new vscode.CodeAction("Explain with Babel Code", vscode.CodeActionKind.RefactorRewrite)
      explain.command = { command: "babel-code.new.explainCode", title: "Explain with Babel Code" }
      actions.push(explain)

      const improve = new vscode.CodeAction("Improve with Babel Code", vscode.CodeActionKind.RefactorRewrite)
      improve.command = { command: "babel-code.new.improveCode", title: "Improve with Babel Code" }
      actions.push(improve)
    }

    return actions
  }
}
