import { existsSync } from "node:fs"

export function target(platform: NodeJS.Platform, arch: string, glibc?: string): string {
  const cpu = arch === "arm64" ? "arm64" : "x64"
  if (platform === "darwin") return `darwin-${cpu}`
  if (platform === "linux") return `${glibc ? "linux" : "alpine"}-${cpu}`
  return `win32-${cpu}`
}

export function resolve(
  platform: NodeJS.Platform,
  arch: string,
  glibc: string | undefined,
  exists: (file: string) => boolean = existsSync,
): string {
  if (platform !== "linux") return target(platform, arch)
  if (glibc) return target(platform, arch, glibc)
  if (exists("/etc/alpine-release")) return target(platform, arch)

  const loaders =
    arch === "arm64"
      ? ["/lib/ld-linux-aarch64.so.1", "/lib64/ld-linux-aarch64.so.1"]
      : ["/lib64/ld-linux-x86-64.so.2", "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"]
  if (loaders.some(exists)) return target(platform, arch, "detected")
  return target(platform, arch)
}

export function detect(): string {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  return resolve(process.platform, process.arch, report?.header?.glibcVersionRuntime)
}
