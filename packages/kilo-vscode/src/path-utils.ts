import * as path from "node:path"

/**
 * Check whether a file path is absolute.
 *
 * Handles both Unix (`/foo/bar`) and Windows (`C:\foo`, `D:/bar`) conventions.
 * UNC paths (`\\server\share`) are also treated as absolute.
 *
 * Returns false for relative paths, bare filenames, empty strings, and
 * protocol-prefixed strings like `https://…`.
 */
export function isAbsolutePath(filePath: string): boolean {
  if (!filePath) return false
  // Unix absolute
  if (filePath.charCodeAt(0) === 47 /* / */) return true
  // Windows drive letter: C:\ or C:/
  if (
    filePath.length >= 3 &&
    filePath.charCodeAt(1) === 58 /* : */ &&
    (filePath.charCodeAt(2) === 92 /* \ */ || filePath.charCodeAt(2) === 47) /* / */ &&
    ((filePath.charCodeAt(0) >= 65 && filePath.charCodeAt(0) <= 90) /* A-Z */ ||
      (filePath.charCodeAt(0) >= 97 && filePath.charCodeAt(0) <= 122)) /* a-z */
  )
    return true
  // Windows UNC path: \\server\share
  if (filePath.length >= 2 && filePath.charCodeAt(0) === 92 /* \ */ && filePath.charCodeAt(1) === 92 /* \ */)
    return true
  return false
}

/**
 * Whether `candidate` resolves to a location inside `root`.
 *
 * Rejects UNC candidates, absolute paths outside the root, and `../` traversal
 * that escapes the root. Used to keep filesystem probes scoped to the trusted
 * session directory so model-generated paths can't reach arbitrary host files.
 */
export function contains(root: string, candidate: string): boolean {
  if (!root || !candidate) return false
  // UNC candidates can trigger outbound filesystem requests on Windows — never allow them.
  if (candidate.startsWith("\\\\") || candidate.startsWith("//")) return false
  const base = path.resolve(root)
  const rel = path.relative(base, path.resolve(base, candidate))
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

/**
 * Escape glob metacharacters so a literal filename can be embedded in a VS Code
 * glob pattern. VS Code globs do not honor backslash escapes, so each special
 * character is wrapped in a single-character bracket expression — e.g.
 * `[id].tsx` becomes `[[]id[]].tsx`.
 */
export function escapeGlob(name: string): string {
  return name.replace(/[*?{}[\]]/g, (c) => (c === "]" ? "[]]" : `[${c}]`))
}

const EXTERNAL_URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i

/**
 * Whether `url` is safe to hand to `vscode.env.openExternal()` -- restricted
 * to http(s) so a link surfaced from untrusted content (assistant output,
 * ingested docs) can't reach a scheme with host-level side effects
 * (`file:`, `vscode:`, a custom URI-handler-registered scheme, etc).
 */
export function isAllowedExternalUrl(url: unknown): url is string {
  if (typeof url !== "string") return false
  const match = EXTERNAL_URL_SCHEME.exec(url)
  if (!match) return false
  const scheme = match[1].toLowerCase()
  return scheme === "http" || scheme === "https"
}
