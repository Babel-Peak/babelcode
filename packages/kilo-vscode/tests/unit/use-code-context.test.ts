import { describe, expect, it } from "bun:test"
import { useCodeContext } from "../../webview-ui/src/hooks/useCodeContext"

describe("useCodeContext", () => {
  it("adds, removes, clears, and replaces code context items", () => {
    const ctx = useCodeContext()

    expect(ctx.items()).toEqual([])

    const item1 = { id: "1", path: "src/a.ts", startLine: 1, endLine: 10, text: "const a = 1" }
    const item2 = { id: "2", path: "src/b.ts", startLine: 5, endLine: 15, text: "const b = 2" }

    ctx.add(item1)
    expect(ctx.items()).toEqual([item1])

    ctx.add(item2)
    expect(ctx.items()).toEqual([item1, item2])

    ctx.remove("1")
    expect(ctx.items()).toEqual([item2])

    ctx.replace([item1])
    expect(ctx.items()).toEqual([item1])

    ctx.clear()
    expect(ctx.items()).toEqual([])
  })
})
