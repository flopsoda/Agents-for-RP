Pending unreleased changes since v1.1.17:

- Accept mixed memory tag pairs.
  - What changed: Memory agent tagged-block parsing now accepts mixed bracket/XML tag pairs such as `[AGENT_NOTE]...</AGENT_NOTE>` and `<MEMORY_UPDATE>...[/MEMORY_UPDATE]` while keeping the prompted output contract bracket-only.
  - Files touched: `risu_agents.js`.
  - Tests/checks run: `osascript -l JavaScript` syntax acceptance for `risu_agents.js`; `osascript -l JavaScript` parser cases for bracket, XML, mixed, mismatched-close, and full mixed memory output; `git diff --check`.
  - Checks not run: `node --check risu_agents.js` because `node` is not available on PATH in this environment.
  - Commit: `b6479b5 Accept mixed memory tag pairs`.
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval.
