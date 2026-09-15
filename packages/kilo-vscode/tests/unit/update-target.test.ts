import { describe, expect, it } from "bun:test"
import { target } from "../../src/services/update-target"

describe("update target", () => {
  it("selects glibc Linux packages", () => {
    expect(target("linux", "x64", "2.39")).toBe("linux-x64")
    expect(target("linux", "arm64", "2.39")).toBe("linux-arm64")
  })

  it("selects Alpine packages when glibc is absent", () => {
    expect(target("linux", "x64", undefined)).toBe("alpine-x64")
    expect(target("linux", "arm64", undefined)).toBe("alpine-arm64")
  })

  it("selects macOS and Windows packages", () => {
    expect(target("darwin", "x64")).toBe("darwin-x64")
    expect(target("darwin", "arm64")).toBe("darwin-arm64")
    expect(target("win32", "x64")).toBe("win32-x64")
    expect(target("win32", "arm64")).toBe("win32-arm64")
  })
})
