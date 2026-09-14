import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/context/session.tsx")
const TRANSCRIPT_ROW_FILE = path.join(ROOT, "webview-ui/src/components/chat/TranscriptRow.tsx")
const USER_MESSAGE_FILE = path.join(ROOT, "webview-ui/src/components/chat/VscodeUserMessage.tsx")
const SESSION_TURN_FILE = path.join(ROOT, "webview-ui/src/components/chat/VscodeSessionTurn.tsx")
const MESSAGE_PART_FILE = path.resolve(ROOT, "../kilo-ui/src/components/message-part.tsx")
const I18N_EN_FILE = path.resolve(ROOT, "../ui/src/i18n/en.ts")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

function extractFunctionBody(source: string, name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start === -1) return ""
  const rest = source.slice(start + marker.length)
  const next = rest.search(/\n  function /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe("sendQueuedMessage in session.tsx", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "sendQueuedMessage")

  it("declares sendQueuedMessage on SessionContextValue", () => {
    expect(source).toContain("sendQueuedMessage: (sessionID: string, messageID: string) => void")
  })

  it("implements sendQueuedMessage", () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it("aborts active turn when status is not idle without reverting context", () => {
    expect(body).toContain('if (currentStatus.type !== "idle")')
    expect(body).toContain('vscode.postMessage({ type: "abort", sessionID })')
    expect(body).not.toContain("revertSession")
  })

  it("deletes the queued message and sends it directly", () => {
    expect(body).toContain("deleteQueuedMessage(sessionID, messageID)")
    expect(body).toContain("sendMessage(")
    expect(body).toContain("sendCommand(")
  })

  it("extracts text, files, and review data from message parts", () => {
    expect(body).toContain("getParts(messageID)")
    expect(body).toContain("extractQueuedPayload(")
  })

  it("exposes sendQueuedMessage in SessionProvider return value", () => {
    expect(source).toContain("sendQueuedMessage,")
  })
})

describe("UI components wire onSendNow for queued messages", () => {
  it("TranscriptRow passes onSendNow to VscodeUserMessage for queued rows", () => {
    const source = readFile(TRANSCRIPT_ROW_FILE)
    expect(source).toMatch(
      /onSendNow=\{\s*row\(\)\.queued\s*\?\s*\(\)\s*=>\s*session\.sendQueuedMessage\(row\(\)\.message\.sessionID,\s*row\(\)\.message\.id\)\s*:\s*undefined\s*\}/,
    )
  })

  it("VscodeUserMessage forwards onSendNow to UserMessageDisplay", () => {
    const source = readFile(USER_MESSAGE_FILE)
    expect(source).toContain("onSendNow?: () => void")
    expect(source).toContain("onSendNow={props.onSendNow}")
  })

  it("VscodeSessionTurn passes onSendNow to UserMessageDisplay when queued", () => {
    const source = readFile(SESSION_TURN_FILE)
    expect(source).toMatch(
      /onSendNow=\{\s*props\.queued\s*\?\s*\(\)\s*=>\s*session\.sendQueuedMessage\(msg\(\)\.sessionID,\s*msg\(\)\.id\)\s*:\s*undefined\s*\}/,
    )
  })

  it("UserMessageDisplay renders arrow-up icon button in queued indicator", () => {
    const source = readFile(MESSAGE_PART_FILE)
    expect(source).toContain('data-slot="user-message-send-now"')
    expect(source).toContain('icon="arrow-up"')
    expect(source).toContain('i18n.t("ui.message.sendNow")')
  })

  it("i18n en.ts defines ui.message.sendNow", () => {
    const source = readFile(I18N_EN_FILE)
    expect(source).toContain('"ui.message.sendNow"')
  })
})
