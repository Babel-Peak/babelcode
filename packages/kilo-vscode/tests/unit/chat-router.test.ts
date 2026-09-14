import { describe, expect, it } from "bun:test"
import {
  attachImageToChat,
  attachToOpenChat,
  type ChatImage,
  type ChatSurface,
  type FileContext,
} from "../../src/kilo-provider/chat-router"

const file: FileContext = { filePath: "src/file.ts", selectedText: "const value = 1", startLine: 1, endLine: 2 }
const image: ChatImage = { filename: "screenshot.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" }

function surface(open: boolean, reveals = true) {
  const calls: string[] = []
  const attached: FileContext[] = []
  const images: ChatImage[] = []
  const s: ChatSurface = {
    open,
    reveal: async () => {
      calls.push("reveal")
      return reveals
    },
    attach: (f) => {
      calls.push("attach")
      attached.push(f)
    },
    attachImage: (img) => {
      calls.push("attachImage")
      images.push(img)
    },
  }
  return { s, calls, attached, images }
}

describe("attachToOpenChat", () => {
  it("attaches the file to the first open surface", async () => {
    const closed = surface(false)
    const open = surface(true)

    const ok = await attachToOpenChat([closed.s, open.s], file)

    expect(ok).toBe(true)
    expect(closed.calls).toEqual([])
    expect(open.calls).toEqual(["reveal", "attach"])
    expect(open.attached).toEqual([file])
  })

  it("falls through when an open surface fails to reveal", async () => {
    const dead = surface(true, false)
    const next = surface(true)

    const ok = await attachToOpenChat([dead.s, next.s], file)

    expect(ok).toBe(true)
    expect(next.attached).toEqual([file])
  })

  it("returns false when no surface is open", async () => {
    const only = surface(false)

    const ok = await attachToOpenChat([only.s], file)

    expect(ok).toBe(false)
    expect(only.calls).toEqual([])
  })

  it("reveals without attaching when there is no file", async () => {
    const only = surface(true)

    const ok = await attachToOpenChat([only.s], undefined)

    expect(ok).toBe(true)
    expect(only.calls).toEqual(["reveal"])
    expect(only.attached).toEqual([])
  })
})

describe("attachImageToChat", () => {
  it("attaches the image to the first open surface", async () => {
    const closed = surface(false)
    const open = surface(true)

    const ok = await attachImageToChat([closed.s, open.s], image)

    expect(ok).toBe(true)
    expect(closed.calls).toEqual([])
    expect(open.calls).toEqual(["reveal", "attachImage"])
    expect(open.images).toEqual([image])
  })

  it("falls through when an open surface fails to reveal", async () => {
    const dead = surface(true, false)
    const next = surface(true)

    const ok = await attachImageToChat([dead.s, next.s], image)

    expect(ok).toBe(true)
    expect(next.images).toEqual([image])
  })

  it("returns false when no surface is open", async () => {
    const only = surface(false)

    const ok = await attachImageToChat([only.s], image)

    expect(ok).toBe(false)
    expect(only.calls).toEqual([])
  })
})
