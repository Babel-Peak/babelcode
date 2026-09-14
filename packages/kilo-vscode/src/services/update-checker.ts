import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as https from "node:https"
import * as vscode from "vscode"

const repo = "Kilo-Org/kilocode"
const extension = "babelcode.babel-code"
const asset = "kilo-vscode"

type Release = {
  tag_name?: string
  assets?: Array<{ name?: string; browser_download_url?: string }>
}

export function checkForUpdate(context: vscode.ExtensionContext): void {
  void check(context).catch((err) => console.warn("[Kilo New] Update check failed:", err))
}

async function check(context: vscode.ExtensionContext): Promise<void> {
  const current = vscode.extensions.getExtension(extension)?.packageJSON?.version
  if (typeof current !== "string") return

  const release = await get<Release>(`https://api.github.com/repos/${repo}/releases/latest`)
  const version = release.tag_name?.replace(/^v/, "")
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

  const name = `${asset}-${target()}.vsix`
  const item = release.assets?.find((entry) => entry.name === name && entry.browser_download_url)
  if (!item?.browser_download_url) {
    void vscode.window.showErrorMessage(`Babel Code update ${version} is not available for this platform.`)
    return
  }

  const file = path.join(os.tmpdir(), name)
  await download(item.browser_download_url, file)
  await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(file))
  await fsp.rm(file, { force: true })
  const reload = await vscode.window.showInformationMessage(
    "Babel Code was updated. Reload VS Code to finish.",
    "Reload",
  )
  if (reload === "Reload") await vscode.commands.executeCommand("workbench.action.reloadWindow")
}

function target(): string {
  const platform = process.platform === "win32" ? "win32" : process.platform
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  if (platform === "darwin") return `darwin-${arch}`
  if (platform === "linux") return `linux-${arch}`
  return `win32-${arch}`
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

function get<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "babel-code-vscode" } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`GitHub returned HTTP ${response.statusCode}`))
        return
      }
      let body = ""
      response.setEncoding("utf8")
      response.on("data", (chunk) => (body += chunk))
      response.on("end", () => resolve(JSON.parse(body) as T))
    })
    request.on("error", reject)
  })
}

function download(url: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "babel-code-vscode" } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`GitHub returned HTTP ${response.statusCode}`))
        return
      }
      const output = fs.createWriteStream(file)
      response.pipe(output)
      output.on("finish", () => output.close(() => resolve()))
      output.on("error", reject)
    })
    request.on("error", reject)
  })
}
