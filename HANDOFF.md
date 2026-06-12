Pending unreleased changes since v1.1.18:

- Show plugin version in the Agents! dashboard.
  - What changed: The settings dashboard header now shows the current plugin version, and the startup console log uses the same version constant instead of the stale `v1.1.11` text.
  - Files touched: `risu_agents.js`.
  - Tests/checks run: `osascript -l JavaScript` syntax acceptance for `risu_agents.js`; `git diff --check`; `rg` check for version-display/log strings.
  - Commit: `cca9bc5 Show plugin version in dashboard`.
  - Release status: version bump, tag, push, and GitHub Release pending immediate v1.1.19 release.
