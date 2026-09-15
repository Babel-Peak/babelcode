import { createHash, randomBytes } from "node:crypto"
import * as vscode from "vscode"

const base = "https://code.babelpeak.com"
const secret = "babel-code.cloud.token"

export class CloudAuth {
  private pending?: { state: string; verifier: string }

  constructor(private readonly context: vscode.ExtensionContext) {}

  token() {
    return this.context.secrets.get(secret)
  }

  async signIn() {
    const verifier = randomBytes(32).toString("base64url")
    const state = randomBytes(32).toString("base64url")
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    this.pending = { state, verifier }
    const url = `${base}/extension/authorize?challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}`
    const opened = await vscode.env.openExternal(vscode.Uri.parse(url))
    if (!opened) void vscode.window.showErrorMessage("Could not open Babel Code sign in.")
  }

  async handle(uri: vscode.Uri) {
    if (uri.path !== "/babelcode/auth" || !this.pending) return false
    const params = new URLSearchParams(uri.query)
    const code = params.get("code")
    const state = params.get("state")
    if (!code || state !== this.pending.state) {
      this.pending = undefined
      void vscode.window.showErrorMessage("Babel Code sign in could not be verified.")
      return true
    }
    const pending = this.pending
    this.pending = undefined
    const response = await fetch(`${base}/api/extensions/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier: pending.verifier }),
    })
    if (!response.ok) {
      void vscode.window.showErrorMessage("Babel Code sign in expired. Please try again.")
      return true
    }
    const body = (await response.json()) as { accessToken?: unknown }
    if (typeof body.accessToken !== "string") throw new Error("Cloud token response is invalid")
    await this.context.secrets.store(secret, body.accessToken)
    void vscode.window.showInformationMessage("Babel Code is connected to your cloud account.")
    return true
  }
}
