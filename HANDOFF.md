Pending unreleased changes since v1.1.17:

- Accept mixed memory tag pairs.
  - What changed: Memory agent tagged-block parsing now accepts mixed bracket/XML tag pairs such as `[AGENT_NOTE]...</AGENT_NOTE>` and `<MEMORY_UPDATE>...[/MEMORY_UPDATE]` while keeping the prompted output contract bracket-only.
  - Files touched: `risu_agents.js`.
  - Tests/checks run: `osascript -l JavaScript` syntax acceptance for `risu_agents.js`; `osascript -l JavaScript` parser cases for bracket, XML, mixed, mismatched-close, and full mixed memory output; `git diff --check`.
  - Checks not run: `node --check risu_agents.js` because `node` is not available on PATH in this environment.
  - Commit: `b6479b5 Accept mixed memory tag pairs`.
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval.

- Merge main-model note injection into target messages.
  - What changed: Main-model Agents! notes now merge into the selected existing message content instead of inserting a new trailing/interleaved system message. `user-tail` merges into the last user message with an English hardcoded guard; `system-tail` merges into the last system message; missing user/system fallbacks are handled without losing `[Check Instruction]`.
  - Files touched: `risu_agents.js`.
  - Tests/checks run: `osascript -l JavaScript` syntax acceptance for `risu_agents.js`; `osascript -l JavaScript` injection behavior checks for user-tail merge, system-tail merge, user-tail fallback, leading system creation, and empty check-instruction omission; `git diff --check`; `rg "Agents! Analysis Context End" .`.
  - Commit: `b11d278 Merge main note injection into target messages`.
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval.
