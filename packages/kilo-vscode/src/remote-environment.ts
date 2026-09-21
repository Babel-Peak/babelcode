import * as vscode from "vscode"

export function isDevContainer() {
  return vscode.env.remoteName === "dev-container"
}
