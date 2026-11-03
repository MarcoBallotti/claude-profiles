# Contributing

Thanks for helping make multi-account workflows less tedious.

1. Use Node.js 22.12+ and run `npm ci`.
2. Run `npm run check` and `npm test` before opening a pull request.
3. Run `npm start` to inspect the app. For disposable data and disabled account actions, use `npm start -- --preview-root /absolute/path/to/disposable-data`.
4. Build a native package with `npm run dist` on the target OS.

Keep platform decisions in `src/core/platform.mjs`, persistence in `src/core/store.mjs`, OS process work in `src/launcher.mjs`, and Electron capabilities in `src/main.mjs`. The renderer has no Node access. New IPC capabilities must validate the sender and payload and expose only the narrow action needed.

Mac preview builds use an ad-hoc signature with hardened runtime. The entitlements in `assets/entitlements.mac.plist` permit Electron's JIT and loading its bundled frameworks without an Apple Team ID. CI verifies every nested bundle signature. These signatures do not replace a Developer ID certificate or notarization.

If macOS signing reports “resource fork, Finder information, or similar detritus not allowed” in a cloud-synced working folder, build into a local temporary directory: `npm run dist:mac -- --config.directories.output=/private/tmp/claude-profiles-dist`. Sync services can attach Finder metadata to generated app bundles; changing the output directory avoids altering system security settings.

If hosted Mac runners are unavailable, maintainers can build both Mac architectures at an existing tag, verify their bundle signatures, and upload the four archives to a draft prerelease. The manual **Publish verified preview packages** workflow combines them with successful Windows/Linux artifacts from the same commit, checks the package set, computes checksums and publishes. Record this build provenance in the release notes. Cancel the original tag workflow first to prevent two publishers; normal tag builds remain the default release path.

Useful contributions include testing actual sign-in flows on each OS, improving installation detection, localization, and handling changes in Claude Desktop’s multi-instance behavior. Describe which OS, Claude version and install channel you tested. A green package build is not evidence of a successful interactive sign-in.

Never commit account data, credentials, cookies, conversation history or a real profile registry. Keep fixtures synthetic. Do not add telemetry, credential extraction, session sharing or automatic account rotation. Tests must use temporary folders and harmless processes; they must not launch Claude or touch the contributor’s real profiles.

This project uses the MIT license. Contributions are submitted under that license.
