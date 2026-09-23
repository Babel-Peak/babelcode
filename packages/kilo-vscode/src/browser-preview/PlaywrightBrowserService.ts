import * as vscode from "vscode"
import * as net from "node:net"
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core"
import { PICKER_INIT_SCRIPT } from "./picker-init-script"
import { normalizeUrl } from "./url"

// playwright-core is kept external by esbuild and loaded lazily so a missing
// copy can never break extension activation — only the browser preview.
let playwright: typeof import("playwright-core") | null = null
function loadPlaywright(): typeof import("playwright-core") {
  if (!playwright) {
    playwright = require("playwright-core") as typeof import("playwright-core")
  }
  return playwright
}

export interface PickedElement {
  url: string
  tagName: string
  id: string
  className: string
  selector: string
  outerHTML: string
  innerText: string
  computedStyle: Record<string, string>
  dimensions: { top: number; left: number; width: number; height: number }
  request?: string
}

/** A screenshot of a user-selected page area, ready for the chat prompt. */
export interface CapturedArea {
  filename: string
  mime: string
  dataUrl: string
}

/** Area selected by the drag overlay, in document CSS pixels. */
interface ShotArea {
  x: number
  y: number
  width: number
  height: number
}

interface TargetMessage {
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  id?: number
  error?: { message: string }
}

interface TargetInfo {
  targetId: string
  type: string
}

const PICK_BRIDGE = "__kiloPickElement"
const STATE_BRIDGE = "__kiloPickerState"
const SCREEN_BRIDGE = "__kiloScreenshotArea"
const MOBILE_BRIDGE = "__kiloMobileMode"

// playwright-core ships no browsers; launch the user's installed browser.
const CHANNELS = ["chrome", "msedge"] as const

const LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"]

const CALL_TIMEOUT_MS = 20_000

/**
 * Persistent system-Chrome browser driven by Playwright, with one window
 * (page) per chat session that opens it. All windows share one browser
 * context (cookies, storage, logins).
 *
 * The element-picker script and its bridges are installed at the CDP level
 * (Target.setDiscoverTargets + per-target addScriptToEvaluateOnNewDocument /
 * Runtime.addBinding), so EVERY page in this browser gets them — whether it
 * was opened by this extension, by the user, or by browser tools driving the
 * browser over CDP.
 *
 * The browser also exposes a CDP endpoint (remote-debugging-port) so the
 * @playwright/mcp server used by browser tools attaches to the SAME browser
 * instead of launching its own instance.
 */
export class PlaywrightBrowserService implements vscode.Disposable {
  private browser: Browser | null = null
  private launching: Promise<Browser> | null = null
  private context: BrowserContext | null = null
  private pages = new Map<string, Page>()
  private endpoint: string | null = null

  // Browser-wide CDP channel used to inject the picker into every page.
  private cdp: CDPSession | null = null
  // targetId -> page-level CDP session id (non-flatten attach).
  private pageSessions = new Map<string, string>()
  // targetId -> chat session id for pages this extension opened.
  private targetSids = new Map<string, string>()
  private mobileTargets = new Set<string>()
  private userAgents = new Map<string, string>()
  // targetId -> in-flight picker wiring, awaited before first navigation.
  private wiredTargets = new Map<string, Promise<void>>()
  private pending = new Map<number, { resolve: (msg: TargetMessage) => void; reject: (err: Error) => void }>()
  private nextId = 1

  /** Set by the extension to route picked elements into an open chat. */
  onElementPicked: ((element: PickedElement) => void) | null = null

  /** Set by the extension to route captured area screenshots into an open chat. */
  onScreenshotCaptured: ((sid: string, shot: CapturedArea) => void) | null = null

  /** Set by the extension to rebind MCP when the user closes the browser. */
  onBrowserClosed: (() => void) | null = null

  /** CDP endpoint of the running browser, or null while none is open. */
  get cdpEndpoint(): string | null {
    return this.endpoint
  }

  /**
   * Open (or focus) the browser window for a chat session. When a URL is
   * given and the window already exists, it navigates to the URL; otherwise a
   * new window is created.
   */
  async openPage(sid: string, raw?: string): Promise<void> {
    const context = await this.ensureContext()
    const page = this.pages.get(sid)
    if (page) {
      await this.navigate(page, raw)
      return
    }
    const created = await context.newPage()
    this.pages.set(sid, created)
    created.on("close", () => {
      if (this.pages.get(sid) === created) this.pages.delete(sid)
    })
    // The picker script is injected per target over CDP; make sure that has
    // landed before the first navigation so it runs from document creation.
    const targetId = await this.rememberSid(created, sid)
    if (targetId) await this.wirePage({ targetId, type: "page" })
    await this.navigate(created, raw)
  }

  /** Close the browser window of a chat session (no-op when none is open). */
  closePage(sid: string): void {
    const page = this.pages.get(sid)
    if (!page) return
    this.pages.delete(sid)
    void page.close().catch(() => {})
  }

  async dispose(): Promise<void> {
    this.pages.clear()
    this.context = null
    this.launching = null
    await this.cdp?.detach().catch(() => {})
    this.cdp = null
    this.pageSessions.clear()
    this.targetSids.clear()
    this.mobileTargets.clear()
    this.userAgents.clear()
    this.wiredTargets.clear()
    const browser = this.browser
    this.browser = null
    await browser?.close().catch(() => {})
  }

  private async navigate(page: Page, raw?: string): Promise<void> {
    const target = normalizeUrl(raw)
    if (target) {
      await page.goto(target.toString(), { waitUntil: "domcontentloaded" }).catch((err) => {
        console.warn(`[Kilo New] Browser preview failed to open ${target.toString()}:`, err)
        void vscode.window.showErrorMessage(`Browser preview could not open ${target.toString()}.`)
      })
    }
    await page.bringToFront().catch(() => {})
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context
    const browser = await this.ensureBrowser()
    const context = await browser.newContext({ bypassCSP: true, viewport: null })
    this.context = context
    return context
  }

  private ensureBrowser(): Promise<Browser> {
    if (this.browser) return Promise.resolve(this.browser)
    if (!this.launching) {
      this.launching = this.launchBrowser().then(
        (browser) => {
          this.browser = browser
          // User closed every window: forget everything so the next open
          // starts a fresh browser instead of reusing a dead handle.
          browser.on("disconnected", () => this.forgetBrowser())
          return browser
        },
        (err) => {
          this.launching = null
          throw err
        },
      )
    }
    return this.launching
  }

  private forgetBrowser(): void {
    this.browser = null
    this.context = null
    this.launching = null
    this.endpoint = null
    this.cdp = null
    this.pageSessions.clear()
    this.targetSids.clear()
    this.mobileTargets.clear()
    this.userAgents.clear()
    this.wiredTargets.clear()
    this.pages.clear()
    this.onBrowserClosed?.()
  }

  private async launchBrowser(): Promise<Browser> {
    let chromium: ReturnType<typeof loadPlaywright>["chromium"]
    try {
      chromium = loadPlaywright().chromium
    } catch (e) {
      console.error("[Kilo New] playwright-core is missing from the installation:", e)
      const message =
        "Browser preview is unavailable: playwright-core is missing from this installation. Reinstall the extension."
      void vscode.window.showErrorMessage(message)
      throw e instanceof Error ? e : new Error(message)
    }
    let err: unknown = null
    for (const channel of CHANNELS) {
      try {
        // Reserve a port for the CDP endpoint so MCP browser tools can attach
        // to this very browser instead of spawning their own instance.
        const port = await freePort()
        const browser = await chromium.launch({
          channel,
          headless: false,
          args: [...LAUNCH_ARGS, `--remote-debugging-port=${port}`],
        })
        this.endpoint = `http://127.0.0.1:${port}`
        await this.startPickerInjection(browser).catch((e) => {
          console.warn("[Kilo New] Browser preview picker injection failed:", e)
        })
        return browser
      } catch (e) {
        err = e
      }
    }
    console.error("[Kilo New] Browser preview could not launch Chrome or Edge:", err)
    const message =
      "Browser preview needs Google Chrome or Microsoft Edge installed on this machine. Install one of them and try again."
    void vscode.window.showErrorMessage(message)
    throw err instanceof Error ? err : new Error(message)
  }

  /**
   * Browser-wide CDP channel: discover every page target (present and future,
   * no matter which client created it) and install the picker script plus its
   * Runtime bindings on each one.
   */
  private async startPickerInjection(browser: Browser): Promise<void> {
    const client = await browser.newBrowserCDPSession()
    this.cdp = client
    client.on("Target.targetCreated", (p: { targetInfo: TargetInfo }) => {
      if (p.targetInfo.type === "page") void this.wirePage(p.targetInfo)
    })
    client.on("Target.targetDestroyed", (p: { targetId: string }) => {
      this.pageSessions.delete(p.targetId)
      this.targetSids.delete(p.targetId)
      this.mobileTargets.delete(p.targetId)
      this.userAgents.delete(p.targetId)
      this.wiredTargets.delete(p.targetId)
    })
    client.on("Target.receivedMessageFromTarget", (p: { sessionId: string; message: string }) => {
      this.handlePageMessage(p.sessionId, p.message)
    })
    client.on("Target.detachedFromTarget", (p: { sessionId: string }) => {
      for (const [targetId, sid] of this.pageSessions) {
        if (sid === p.sessionId) this.pageSessions.delete(targetId)
      }
    })
    // discover:true also reports already-running page targets.
    await client.send("Target.setDiscoverTargets", { discover: true })
  }

  private async wirePage(info: TargetInfo): Promise<void> {
    const existing = this.wiredTargets.get(info.targetId)
    if (existing) return existing
    const wire = this.doWire(info)
    this.wiredTargets.set(info.targetId, wire)
    return wire
  }

  private async doWire(info: TargetInfo): Promise<void> {
    const client = this.cdp
    if (!client) return
    const { sessionId } = await client.send("Target.attachToTarget", { targetId: info.targetId, flatten: false })
    this.pageSessions.set(info.targetId, sessionId)
    await this.pageCall(sessionId, "Page.enable")
    await this.pageCall(sessionId, "Runtime.enable")
    await this.pageCall(sessionId, "Page.addScriptToEvaluateOnNewDocument", { source: PICKER_INIT_SCRIPT })
    for (const name of [PICK_BRIDGE, STATE_BRIDGE, SCREEN_BRIDGE, MOBILE_BRIDGE]) {
      await this.pageCall(sessionId, "Runtime.addBinding", { name })
    }
    // The target may already have a document (created by another CDP client
    // that navigated before we wired it): run the script in the current one
    // too. The script's __kiloPickerLoaded guard keeps double runs harmless.
    await this.pageCall(sessionId, "Runtime.evaluate", { expression: PICKER_INIT_SCRIPT }).catch(() => {})
  }

  private handlePageMessage(sessionId: string, raw: string): void {
    let msg: TargetMessage
    try {
      msg = JSON.parse(raw) as TargetMessage
    } catch {
      return
    }
    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error.message))
        else pending.resolve(msg)
      }
      return
    }
    if (msg.method === "Runtime.bindingCalled") {
      const params = msg.params as { name?: string; payload?: string } | undefined
      if (params?.name && typeof params.payload === "string") {
        this.onBridge(sessionId, params.name, params.payload)
      }
    }
    if (msg.method === "Page.domContentEventFired") {
      const target = this.targetForSession(sessionId)
      if (target && this.mobileTargets.has(target)) {
        void this.pageCall(sessionId, "Runtime.evaluate", { expression: "window.__kiloSetMobileMode?.(true)" }).catch(
          (err) => console.warn("[Kilo New] Browser preview could not sync mobile icon:", err),
        )
      }
    }
  }

  private onBridge(sessionId: string, name: string, payload: string): void {
    const targetId = this.targetForSession(sessionId)
    if (!targetId) return
    if (name === PICK_BRIDGE) {
      try {
        this.onElementPicked?.(JSON.parse(payload) as PickedElement)
      } catch (err) {
        console.warn("[Kilo New] Browser preview invalid pick payload:", err)
      }
      return
    }
    if (name === STATE_BRIDGE) {
      console.log(`[Kilo New] Browser preview picker ${payload === "true" ? "active" : "inactive"}`)
      return
    }
    if (name === MOBILE_BRIDGE) {
      void this.switchDevice(sessionId, targetId, payload === "true").catch((err) => {
        console.warn("[Kilo New] Browser preview could not change device:", err)
        void vscode.window.showWarningMessage("Browser preview could not change the device.")
      })
      return
    }
    if (name === SCREEN_BRIDGE) {
      try {
        const area = JSON.parse(payload) as ShotArea
        void this.captureArea(targetId, area)
      } catch (err) {
        console.warn("[Kilo New] Browser preview invalid capture payload:", err)
      }
    }
  }

  private async switchDevice(sessionId: string, target: string, mobile: boolean): Promise<void> {
    if (mobile) {
      const device = loadPlaywright().devices["iPhone 13"]
      const reply = await this.pageRequest(sessionId, {
        method: "Runtime.evaluate",
        params: { expression: "navigator.userAgent", returnByValue: true },
      })
      const agent = (reply.result?.result as { value?: string } | undefined)?.value
      if (agent) this.userAgents.set(target, agent)
      await this.pageCall(sessionId, "Network.enable")
      await this.pageCall(sessionId, "Network.setUserAgentOverride", { userAgent: device.userAgent })
      await this.pageCall(sessionId, "Emulation.setDeviceMetricsOverride", {
        width: device.viewport.width,
        height: device.viewport.height,
        screenWidth: device.viewport.width,
        screenHeight: device.viewport.height,
        deviceScaleFactor: device.deviceScaleFactor,
        mobile: device.isMobile,
        screenOrientation: { type: "portraitPrimary", angle: 0 },
      })
      await this.pageCall(sessionId, "Emulation.setTouchEmulationEnabled", {
        enabled: device.hasTouch,
        maxTouchPoints: 1,
      })
      this.mobileTargets.add(target)
      await this.pageCall(sessionId, "Runtime.evaluate", { expression: "window.__kiloSetMobileMode?.(true)" })
      return
    }
    await this.pageCall(sessionId, "Emulation.setTouchEmulationEnabled", { enabled: false })
    await this.pageCall(sessionId, "Emulation.clearDeviceMetricsOverride")
    await this.pageCall(sessionId, "Network.setUserAgentOverride", { userAgent: this.userAgents.get(target) ?? "" })
    this.mobileTargets.delete(target)
    this.userAgents.delete(target)
    await this.pageCall(sessionId, "Runtime.evaluate", { expression: "window.__kiloSetMobileMode?.(false)" })
  }

  private targetForSession(sessionId: string): string | undefined {
    for (const [targetId, sid] of this.pageSessions) {
      if (sid === sessionId) return targetId
    }
    return undefined
  }

  /** Fire-and-forget command inside a page target. */
  private async pageCall(sessionId: string, method: string, params?: Record<string, unknown>): Promise<void> {
    await this.pageRequest(sessionId, { method, params })
  }

  /** Command inside a page target that expects a response payload. */
  private pageRequest(
    sessionId: string,
    body: { method: string; params?: Record<string, unknown> },
  ): Promise<TargetMessage> {
    const client = this.cdp
    if (!client) return Promise.reject(new Error("Browser preview CDP channel closed"))
    const id = this.nextId++
    const message = JSON.stringify({ ...body, id })
    return new Promise<TargetMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${body.method} timed out`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer)
          resolve(msg)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      void client.send("Target.sendMessageToTarget", { sessionId, message }).catch((err: unknown) => {
        const pending = this.pending.get(id)
        if (pending) {
          this.pending.delete(id)
          pending.reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
  }

  /** Capture the drag-selected area of a page and hand it to the chat. */
  private async captureArea(targetId: string, area: ShotArea): Promise<void> {
    const sessionId = this.pageSessions.get(targetId)
    if (!sessionId || !this.onScreenshotCaptured) return
    if (!Number.isFinite(area.x) || !Number.isFinite(area.y)) return
    const clip = {
      x: Math.round(area.x),
      y: Math.round(area.y),
      width: Math.max(1, Math.round(area.width)),
      height: Math.max(1, Math.round(area.height)),
    }
    const setChrome = (visible: boolean) =>
      this.pageCall(sessionId, "Runtime.evaluate", {
        expression: `window.__kiloSetPickerChrome && window.__kiloSetPickerChrome(${visible})`,
      })
    try {
      // Keep the picker UI out of the image while it overlays the selection.
      await setChrome(false)
      // captureBeyondViewport lets the clip cover areas beyond the visible
      // viewport; coordinates are document pixels from the selection overlay.
      const reply = await this.pageRequest(sessionId, {
        method: "Page.captureScreenshot",
        params: { format: "png", clip: { ...clip, scale: 1 }, captureBeyondViewport: true },
      })
      const data = reply.result?.data
      if (!data) throw new Error("Empty capture")
      const shot: CapturedArea = {
        filename: `screenshot-${Date.now()}.png`,
        mime: "image/png",
        dataUrl: `data:image/png;base64,${data}`,
      }
      this.onScreenshotCaptured(this.targetSids.get(targetId) ?? "mcp", shot)
    } catch (err) {
      console.warn("[Kilo New] Browser preview area capture failed:", err)
      void vscode.window.showWarningMessage("Browser preview could not capture the selected area.")
    } finally {
      await setChrome(true).catch(() => {})
    }
  }

  /** Map a page we opened to its chat session id; returns its CDP target id. */
  private async rememberSid(page: Page, sid: string): Promise<string | undefined> {
    try {
      const session = await page.context().newCDPSession(page)
      const { targetInfo } = await session.send("Target.getTargetInfo")
      this.targetSids.set(targetInfo.targetId, sid)
      await session.detach().catch(() => {})
      return targetInfo.targetId
    } catch (err) {
      console.warn("[Kilo New] Browser preview could not map page target:", err)
      return undefined
    }
  }
}

/** Grab a free TCP port for Chromium's --remote-debugging-port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = addr && typeof addr === "object" ? addr.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("Failed to reserve CDP port"))))
    })
  })
}
