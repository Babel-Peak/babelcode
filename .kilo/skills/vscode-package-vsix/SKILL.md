---
name: vscode-package-vsix
description: Use when packaging a full, self-contained VSIX for the Kilo / Babel Code VS Code extension that can be installed directly on other machines.
---

# Packaging a Full VS Code Extension VSIX

Guide for creating a complete, self-contained `.vsix` installer for the VS Code extension that works out-of-the-box on any machine.

## Background & Architecture

The VS Code extension requires a bundled CLI backend executable at `packages/kilo-vscode/bin/kilo`.
- During development, `script/local-bin.ts` may fall back to a source wrapper bash script if binary compilation fails.
- A source wrapper contains hardcoded paths to the developer's local machine (e.g. `cd /home/.../packages/opencode`) and Bun runtime, which crashes immediately on other machines with:
  `CLI process exited with code 1 before server started`
- A **full VSIX** must bundle the real compiled standalone binary (`bin/kilo` > 200MB), tree-sitter grammars, sandbox workers, and helper tools.

## Packaging Steps

Run commands from `packages/kilo-vscode/`:

### 1. Build Production Bundles & Compiled CLI Binary

```bash
bun run package
```

This executes:
1. `prepare:cli-binary:compiled` (`bun script/local-bin.ts --compiled`): builds or stages the standalone compiled binary and resources in `bin/`.
2. `prepare:sdk`: ensures SDK client types are generated.
3. `build:check:production`: typechecks, lints, and bundles extension host + webview in production mode (`esbuild.js --production`).

### 2. Package into VSIX

```bash
bunx @vscode/vsce package --no-dependencies --skip-license -o ./babel-code-<version>.vsix
```

*(Note: `vscode:prepublish` in `package.json` automatically triggers `bun run package` if `vsce package` is run directly).*

### 3. Multi-Platform Matrix Builds (Optional)

To package platform-specific VSIX files for all supported architectures (Linux x64/arm64, Alpine x64/arm64, macOS x64/arm64, Windows x64/arm64):

```bash
bun script/build.ts
```

Output `.vsix` files will be placed in `packages/kilo-vscode/out/`.

## Verification Checklist

Always verify the generated VSIX before distributing to other machines:

1. **Verify binary is compiled (not a bash script)**:
   ```bash
   file bin/kilo
   # Expected: ELF 64-bit LSB executable (or Mach-O / PE32+ executable)
   ```

2. **Verify binary in VSIX archive**:
   ```bash
   unzip -l ./babel-code-*.vsix | grep "bin/kilo"
   # Expected: extension/bin/kilo uncompressed size > 200 MB (e.g. ~230,000,000 bytes)
   ```

3. **Verify VSIX installation**:
   ```bash
   code --install-extension ./babel-code-*.vsix
   ```

## Linux Build Notes

- When building on Linux, if `zig` is not installed, the build skips compiling bundled bubblewrap (`KILO_SKIP_BUNDLED_BWRAP=1`) and `bwrap-helper.ts` automatically stages system `bwrap` or sandbox fallbacks.
