/**
 * Convert a dropped file URI or absolute path into a relative workspace path.
 * Strips file://, vscode-file://, and vscode-remote:// protocols, decodes URI components,
 * and produces a relative path (e.g. "src/index.ts") when the file is inside
 * the workspace. Returns the cleaned absolute path for files outside the workspace.
 *
 * The returned path does NOT include the "@" prefix — callers add that when
 * inserting into the textarea so the path can also be registered in mentionedPaths.
 */
/**
 * Strip file://, vscode-file://, and vscode-remote:// schemes plus any selection
 * fragment. Returns undefined when the input is not one of those URIs.
 */
function stripUriScheme(raw: string): string | undefined {
  let cleaned = raw
  if (raw.startsWith("file://")) {
    cleaned = raw.substring(7)
  } else if (raw.startsWith("vscode-file://vscode-app/")) {
    cleaned = raw.substring("vscode-file://vscode-app/".length)
  } else if (raw.startsWith("vscode-remote://")) {
    const rest = raw.substring("vscode-remote://".length)
    const idx = rest.indexOf("/")
    cleaned = idx !== -1 ? rest.substring(idx) : ""
  } else {
    return undefined
  }

  // Editor-tab drags append selection ranges as URI fragments (e.g. #L4,8).
  // Strip the raw fragment before decoding so %23 (a literal # in a filename) survives.
  const hash = cleaned.indexOf("#")
  return hash !== -1 ? cleaned.substring(0, hash) : cleaned
}

export function convertToMentionPath(path: string, cwd: string): string {
  let cleaned = path.trim()

  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim()
  }

  const uriStripped = stripUriScheme(cleaned)
  if (uriStripped !== undefined) cleaned = uriStripped

  try {
    cleaned = decodeURIComponent(cleaned)
    // Remove leading slash for Windows paths like /d:/... or /D:/...
    if (cleaned.startsWith("/") && cleaned.length >= 3 && cleaned[2] === ":") {
      cleaned = cleaned.substring(1)
    }
  } catch (err) {
    console.error("[Kilo New] Failed to decode dropped URI:", err, cleaned)
  }

  const normalized = cleaned.replace(/\\/g, "/")
  let root = cwd.replace(/\\/g, "/")
  if (root.endsWith("/")) root = root.slice(0, -1)

  if (!root) return cleaned

  if (normalized.toLowerCase().startsWith(root.toLowerCase())) {
    const tail = normalized.substring(root.length)
    // Boundary check: next char must be "/" or end of string to avoid
    // /workspace/app matching /workspace/app2/file.ts
    if (tail === "" || tail.startsWith("/")) {
      const relative = tail.startsWith("/") ? tail.substring(1) : tail
      return relative || cleaned
    }
  }

  return cleaned
}

/** Returns true when the line looks like a file URI or absolute path. */
function isFilePath(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.startsWith("file://") || trimmed.startsWith("vscode-remote://") || trimmed.startsWith("vscode-file://")) {
    return true
  }
  // Unix absolute path
  if (trimmed.startsWith("/")) return true
  // Windows absolute path (e.g. C:\, D:/)
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true
  return false
}

function parseJsonList(val: string): string[] | null {
  const trimmed = val.trim()
  if (!trimmed.startsWith("[")) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const valid = parsed.map((p) => (typeof p === "string" ? p.trim() : "")).filter((p) => p !== "")
      if (valid.length > 0) return valid
    }
  } catch {}
  return null
}

function parseVscodeUriList(val: string): string[] | null {
  const json = parseJsonList(val)
  if (json) return json
  const paths = val
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return paths.length > 0 ? paths : null
}

function parseStandardUriList(val: string): string[] | null {
  const paths = val
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
  return paths.length > 0 ? paths : null
}

function parseTextLines(val: string): string[] | null {
  const json = parseJsonList(val)
  if (json && json.every(isFilePath)) return json
  const lines = val
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return lines.length > 0 && lines.every(isFilePath) ? lines : null
}

function parseFileList(files: FileList | null | undefined): string[] | null {
  if (!files || files.length === 0) return null
  const paths: string[] = []
  for (const f of Array.from(files)) {
    const p = (f as unknown as { path?: string }).path || f.name
    if (p) paths.push(p)
  }
  return paths.length > 0 && paths.every((p) => isFilePath(p) || p.includes(".")) ? paths : null
}

/**
 * Custom MIME type used for internal drag-and-drop of relative file paths
 * (e.g. from diff panel file headers). Unlike VS Code's URI list, these
 * are workspace-relative paths that can be used directly as @mentions.
 */
export const KILO_FILE_PATH_MIME = "application/x-kilo-file-path"

/**
 * VS Code resource drags (Explorer, editor tabs) set ResourceURLs to a JSON
 * array of resource URIs. Type names are lowercased by the drag data store.
 */
export const RESOURCE_URLS_MIME = "resourceurls"

/**
 * VS Code sets CodeFiles to a JSON array of absolute file-system paths
 * (used for cross-window Explorer drags; file-scheme resources only).
 */
export const CODE_FILES_MIME = "codefiles"

/**
 * Extract file paths from a drop's DataTransfer.
 * Checks (in order):
 * 1. Internal relative-path drag (application/x-kilo-file-path)
 * 2. ResourceURLs — VS Code Explorer/editor drags, JSON URI array
 * 3. CodeFiles — VS Code cross-window drags, JSON absolute-path array
 * 4. VS Code URI-list (application/vnd.code.uri-list, handles JSON and newline formats)
 * 5. text/uri-list (may carry only the first URI for VS Code drags)
 * 6. text/plain — only when every line looks like an absolute file path
 * 7. DataTransfer.files — for non-image file paths
 *
 * Returns null if no file paths are found.
 */
export function extractDropPaths(dt: DataTransfer): string[] | null {
  const kilo = dt.getData(KILO_FILE_PATH_MIME)
  if (kilo) {
    const paths = kilo
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "")
    if (paths.length > 0) return paths
  }

  const resUrls = dt.getData(RESOURCE_URLS_MIME)
  if (resUrls) {
    const paths = parseVscodeUriList(resUrls)
    if (paths) return paths
  }

  const codeFiles = dt.getData(CODE_FILES_MIME)
  if (codeFiles) {
    const paths = parseVscodeUriList(codeFiles)
    if (paths) return paths
  }

  const uri = dt.getData("application/vnd.code.uri-list")
  if (uri) {
    const paths = parseVscodeUriList(uri)
    if (paths) return paths
  }

  const uriList = dt.getData("text/uri-list")
  if (uriList) {
    const paths = parseStandardUriList(uriList)
    if (paths) return paths
  }

  const text = dt.getData("text")
  if (text) {
    const paths = parseTextLines(text)
    if (paths) return paths
  }

  return parseFileList(dt.files)
}
