export function target(platform: NodeJS.Platform, arch: string, glibc?: string): string {
  const cpu = arch === "arm64" ? "arm64" : "x64"
  if (platform === "darwin") return `darwin-${cpu}`
  if (platform === "linux") return `${glibc ? "linux" : "alpine"}-${cpu}`
  return `win32-${cpu}`
}

export function detect(): string {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  return target(process.platform, process.arch, report?.header?.glibcVersionRuntime)
}
