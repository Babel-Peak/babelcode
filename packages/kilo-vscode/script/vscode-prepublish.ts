#!/usr/bin/env bun
import { $ } from "bun"

// vsce runs vscode:prepublish once per `vsce package` invocation. When packaging
// multiple platform targets, script/build.ts already runs the full prepublish
// work once, so skip the redundant re-run via this flag.
if (process.env.KILO_SKIP_PREPUBLISH === "1") {
  console.log("Skipping vscode:prepublish (KILO_SKIP_PREPUBLISH=1)")
  process.exit(0)
}

await $`bun run package`
