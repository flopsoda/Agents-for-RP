Pending unreleased changes since v1.1.13:

- Added a Row 5 Main Model option for Agents! note injection placement.
  - Files touched: `risu_agents.js`
  - What changed: `pipeline.mainModel.injectionTarget` now defaults to `system-tail`. Both placement modes insert a new `{ role: 'system' }` message instead of merging into existing message content. `system-tail` inserts after the last system message; `user-tail` inserts after the last user message. If the target role is missing, the system message is appended to the request tail. Debug logging now reports requested/actual placement, insert index, inserted role, message count, and final message role.
  - UI: Main Model Editor now has `마지막 System 뒤에 추가` and `마지막 User 뒤에 추가` options using the same top tab styling as the Settings / Run Inspector switch.
  - Tests/checks: `git diff --check`; syntax check via Node-backed REPL `vm.Script` passed. `node --check risu_agents.js` could not run because `node` is not on PATH.
  - Commits: `fc23ca4 Add main model injection target option`; `8e7ac8e Use system messages for injection placement`; `ee866bb Match injection toggle tab styling`
  - Release status: version bump, push, tag, and GitHub Release intentionally skipped pending user confirmation.
