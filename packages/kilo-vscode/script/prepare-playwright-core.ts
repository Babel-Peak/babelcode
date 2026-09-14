#!/usr/bin/env bun
// playwright-core is external in the esbuild bundle (its __dirname-relative
// browser lookups break when inlined), so the package itself must ship in the
// VSIX. Bun hoists it to the monorepo root node_modules, which vsce cannot
// see, so copy it into dist/node_modules — Node resolves `playwright-core`
// from dist/extension.js through dist/node_modules, and vsce only hard-ignores
// the top-level node_modules directory (not nested ones under dist/).
import { join } from "node:path"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"

export function preparePlaywrightCore() {
  const root = join(import.meta.dir, "..")
  const src = join(root, "..", "..", "node_modules", "playwright-core")
  const dest = join(root, "dist", "node_modules", "playwright-core")
  if (!existsSync(src)) {
    throw new Error(`playwright-core not found at ${src} — run bun install first`)
  }
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
  console.log("  ✓ Copied playwright-core into dist/node_modules for packaging")
}

if (import.meta.main) preparePlaywrightCore()
