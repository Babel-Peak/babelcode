// Schemes that must never be coerced into a preview URL. Anything not listed
// and not already http(s) still defaults to http:// (so "localhost:3000"
// works), while the post-parse protocol check rejects the rest.
const NON_HTTP_SCHEMES =
  /^(?:file|javascript|data|blob|about|ftp|ftps|ws|wss|chrome|chrome-extension|view-source|vbscript|vscode|vscode-insiders|mailto|tel|urn):/i

/** Parse a user-supplied URL, defaulting the scheme to http://. */
export function normalizeUrl(raw?: string): URL | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (NON_HTTP_SCHEMES.test(trimmed)) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url
  } catch {
    return null
  }
}
