import { describe, expect, it } from "bun:test"
import { resolve, target } from "../../src/services/update-target"

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

  it("detects glibc when Electron omits it from the process report", () => {
    const exists = (file: string) => file === "/lib64/ld-linux-x86-64.so.2"
    expect(resolve("linux", "x64", undefined, exists)).toBe("linux-x64")
  })

  it("detects arm64 glibc from its runtime loader", () => {
    const exists = (file: string) => file === "/lib/ld-linux-aarch64.so.1"
    expect(resolve("linux", "arm64", undefined, exists)).toBe("linux-arm64")
  })

  it("keeps Alpine on musl when compatibility loaders are installed", () => {
    const exists = (file: string) => ["/etc/alpine-release", "/lib64/ld-linux-x86-64.so.2"].includes(file)
    expect(resolve("linux", "x64", undefined, exists)).toBe("alpine-x64")
  })
})
