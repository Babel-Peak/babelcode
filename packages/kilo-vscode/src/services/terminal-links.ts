import * as vscode from "vscode"
import { normalizeUrl } from "../browser-preview/url"

interface PreviewTerminalLink extends vscode.TerminalLink {
  url: string
}

type LinkChoice = "preview" | "external"

interface ChoiceItem extends vscode.QuickPickItem {
  action?: LinkChoice | "always-preview" | "always-external"
}

const REMEMBER_KEY = "browserPreview.terminalLinkChoice"

// http(s) URLs, localhost:<port>, or a bare IPv4 with a port. Ports need at
// least two digits, and bare hostnames/IPs without a port are skipped to
// avoid matching versions like 1.2.3.4.
const URL_PATTERN =
  /(?:https?:\/\/[^\s'"<>()\[\]{}]+|localhost:\d{2,5}(?:\/[^\s'"<>()\[\]{}]*)?|(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}(?:\/[^\s'"<>()\[\]{}]*)?)/g

/** Find openable URLs in a terminal line. */
export function detectTerminalLinks(text: string): { startIndex: number; length: number; url: string }[] {
  const links: { startIndex: number; length: number; url: string }[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0].replace(/[.,;:!?)\]]+$/, "")
    if (!raw) continue
    const startIndex = match.index ?? 0
    // Only shrink when trimming actually cut something, so the link never
    // ends up empty or misaligned with the original match.
    const length = raw.length < match[0].length ? raw.length : match[0].length
    links.push({ startIndex, length, url: raw })
  }
  return links
}

/**
 * Terminal link provider: Ctrl+click on a URL in any terminal offers opening
 * it in the shared Playwright browser preview (so the picker/screenshot tools
 * are available) or the default browser. The choice can be remembered.
 */
export function registerTerminalPreviewLinks(context: vscode.ExtensionContext): void {
  const provider: vscode.TerminalLinkProvider<PreviewTerminalLink> = {
    provideTerminalLinks(line: vscode.TerminalLinkContext): PreviewTerminalLink[] {
      return detectTerminalLinks(line.line).map((link) => ({
        startIndex: link.startIndex,
        length: link.length,
        url: link.url,
        tooltip: "Open with Babel or the default browser",
      }))
    },
    async handleTerminalLink(link: PreviewTerminalLink): Promise<void> {
      const target = normalizeUrl(link.url)
      if (!target) {
        await vscode.env.openExternal(vscode.Uri.parse(link.url))
        return
      }
      const choice = await choose(context, target)
      if (choice === "preview") {
        await vscode.commands.executeCommand("babel-code.new.browserPreview.open", target.toString())
      } else if (choice === "external") {
        await vscode.env.openExternal(vscode.Uri.parse(target.toString()))
      }
    },
  }
  context.subscriptions.push(vscode.window.registerTerminalLinkProvider(provider))
}

async function choose(context: vscode.ExtensionContext, target: URL): Promise<LinkChoice | undefined> {
  const remembered = context.globalState.get<LinkChoice>(REMEMBER_KEY)
  if (remembered === "preview" || remembered === "external") return remembered
  const items: ChoiceItem[] = [
    { label: "$(browser) Open in Browser Preview", detail: target.toString(), action: "preview" },
    { label: "$(link-external) Open in Default Browser", detail: target.toString(), action: "external" },
    { label: "$(pin) Always open in Browser Preview", action: "always-preview" },
    { label: "$(pin) Always open in Default Browser", action: "always-external" },
  ]
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Open link…" })
  if (!pick?.action) return undefined
  if (pick.action === "always-preview" || pick.action === "always-external") {
    const action: LinkChoice = pick.action === "always-preview" ? "preview" : "external"
    await context.globalState.update(REMEMBER_KEY, action)
    return action
  }
  return pick.action
}
