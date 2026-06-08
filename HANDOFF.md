Pending unreleased changes since v1.1.13:

- Added a Row 5 Main Model option for Agents! note injection placement.
  - Files touched: `risu_agents.js`
  - What changed: `pipeline.mainModel.injectionTarget` now defaults to `system-tail`, preserving the previous behavior. A new `user-tail` option appends Agents! analysis context to the last user message and falls back to system-tail when no user message exists. Debug logging now reports requested/actual injection placement, message count, and final message role.
  - UI: Main Model Editor now has `System 메시지 끝` and `User 메시지 끝` button options using the existing primary/ghost button style.
  - Tests/checks: `git diff --check`; syntax check via Node-backed REPL `vm.Script` passed. `node --check risu_agents.js` could not run because `node` is not on PATH.
  - Commit: `fc23ca4 Add main model injection target option`
  - Release status: version bump, push, tag, and GitHub Release intentionally skipped pending user confirmation.
