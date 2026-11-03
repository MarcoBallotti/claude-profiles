# Security

Please report vulnerabilities privately using GitHub’s **Security → Report a vulnerability** feature on this repository. Do not post tokens, cookies or personal profile data in public issues. If private reporting is unavailable, open an issue requesting a private contact without including exploit details or sensitive data.

Claude Profiles does not inspect the OS credential store or proxy Claude traffic. It launches the installed Claude applications with profile-specific directories. This separates local application state; it does not sandbox Claude’s access to the filesystem or override enterprise policy.

The Electron renderer uses context isolation, sandboxing, disabled Node integration, a local-only Content Security Policy and validated IPC. Remote navigation, popups, webviews and permission requests are denied. The main process is privileged; installed executables and profile folders are selected explicitly.

The app does not collect analytics or send network requests. Explicit documentation links open in the system browser. Claude Desktop and Claude Code retain their own network behavior.

Only the latest release is maintained. Desktop multi-profile launching is based on a compatibility mechanism rather than a stable Anthropic API. Please treat preview builds accordingly.

## Build dependency audit

The application ships no third-party runtime npm dependencies. Its Electron runtime is pinned and should be kept current. The packaging toolchain currently includes transitive `minimatch` versions affected by [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), a denial-of-service issue triggered by crafted glob patterns. Those packages run during builds, using repository-controlled patterns, and are not bundled into the application. Do not run builds from untrusted pull requests with privileged secrets. Dependabot tracks toolchain updates; a forced downgrade of electron-builder or incompatible major override is not used to hide this audit finding.
