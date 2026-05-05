# DeepCode macOS Menu Bar App

SwiftUI menu bar companion to `@vegamo/deepcode-cli`. Drives the CLI as a Node sidecar via NDJSON over stdio.

## Architecture

```
[ MenuBarExtra UI ]  ←→  [ ChatViewModel ]  ←→  [ JSONRPCBridge ]  ←pipe→  [ deepcode headless ]
                                                                                |
                                                                                ↓
                                                                         [ SessionManager (JS) ]
```

## Build locally

You need Xcode 15+ and Node 18.17+.

```bash
brew install xcodegen          # one-time
cd apps/macos-menubar
bash scripts/stage-sidecar.sh  # builds dist/cli.cjs and copies it into Resources/sidecar
xcodegen generate              # regenerates DeepCode.xcodeproj from project.yml
open DeepCode.xcodeproj
```

Then `Cmd+R` in Xcode. The menu bar gets a sparkles icon; click → quick chat.

## Release

Push a `macos-v*` tag (e.g. `macos-v0.1.0`) to trigger `.github/workflows/release-macos.yml`. CI:

1. builds `dist/cli.cjs` (Node 18.17)
2. stages prod-only `node_modules` and a universal Node binary (arm64+x64) into `Resources/sidecar/`
3. `xcodegen generate` + `xcodebuild archive` (unsigned for MVP)
4. produces a DMG and uploads it to a GitHub Release

For signed/notarized builds, populate the `MACOS_*` / `APPLE_*` secrets and switch the export step to manual signing.

## Files

- `project.yml` — xcodegen spec; project file is regenerated and not committed
- `DeepCode/DeepCodeApp.swift` — `@main` and `MenuBarExtra`
- `DeepCode/Sidecar/` — Process + NDJSON bridge to the CLI
- `DeepCode/Models/ChatViewModel.swift` — `@MainActor` state for the popover
- `DeepCode/Views/` — SwiftUI components
- `DeepCode/Services/SettingsLoader.swift` — read-only access to `~/.deepcode/settings.json`
- `DeepCode/Resources/sidecar/` — populated at build time; `.gitkeep` is the only checked-in file

## Settings & sessions

This MVP shares state with the CLI and the VSCode extension:

- Settings: `~/.deepcode/settings.json` (read-only from the app)
- Sessions: `~/.deepcode/projects/{projectCode}/sessions-index.json` and `*.jsonl`
- Skills: `~/.agents/skills/` and `./.deepcode/skills/`

If you create a session in the app, you'll see it in `deepcode /resume` and vice versa.
