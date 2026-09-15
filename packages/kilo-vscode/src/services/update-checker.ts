import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { detect } from "./update-target"

const extension = "babelcode.babel-code"
const asset = "kilo-vscode"
const updateUrl = "https://code.babelpeak.com/api/extensions/stable"

type Release = { version?: string; downloadUrl?: string }

export function checkForUpdate(context: vscode.ExtensionContext, token: string): void {
  void check(context, token).catch((err) => console.warn("[Kilo New] Update check failed:", err))
}

async function check(context: vscode.ExtensionContext, token: string): Promise<void> {
  const current = vscode.extensions.getExtension(extension)?.packageJSON?.version
  if (typeof current !== "string") return

  const release = await get<Release>(`${updateUrl}/latest?target=${encodeURIComponent(detect())}`, token)
  const version = release.version
  if (!version || !newer(current, version)) return

  const dismissed = context.globalState.get<string>("babel-code.update.dismissed")
  if (dismissed === version) return

  const choice = await vscode.window.showInformationMessage(
    `Babel Code ${version} is available (you have ${current}).`,
    "Update now",
    "Ask me later",
  )
  if (choice === "Ask me later") return
  if (choice !== "Update now") return

  if (!release.downloadUrl) {
    void vscode.window.showErrorMessage(`Babel Code update ${version} is not available for this platform.`)
    return
  }

  const name = `${asset}-${detect()}.vsix`
  const file = path.join(os.tmpdir(), name)
  await download(new URL(release.downloadUrl, updateUrl).toString(), file, token)
  await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(file))
  await fsp.rm(file, { force: true })
  const reload = await vscode.window.showInformationMessage(
    "Babel Code was updated. Reload VS Code to finish.",
    "Reload",
  )
  if (reload === "Reload") await vscode.commands.executeCommand("workbench.action.reloadWindow")
}

function newer(current: string, next: string): boolean {
  const a = current.split(".").map(Number)
  const b = next.split(".").map(Number)
  for (const index of [0, 1, 2]) {
    if ((b[index] ?? 0) > (a[index] ?? 0)) return true
    if ((b[index] ?? 0) < (a[index] ?? 0)) return false
  }
  return false
}

async function get<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "babel-code-vscode" },
  })
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function download(url: string, file: string, token: string): Promise<void> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "babel-code-vscode" },
  })
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}`)
  await fsp.writeFile(file, Buffer.from(await response.arrayBuffer()))
}
