Pending unreleased changes since v1.1.15:

- Changed the default Main Model injection placement to user-tail.
  - Files touched: `risu_agents.js`
  - What changed: missing or invalid `pipeline.mainModel.injectionTarget` values now default to `user-tail`, so new/default pipelines insert the Agents! analysis system message after the last user message. Explicit saved `system-tail` selections are preserved.
  - Tests/checks: `git diff --check`; syntax check via Node-backed REPL `vm.Script` passed. `node --check risu_agents.js` could not run because `node` is not on PATH.
  - Commit: `e5e235c Default main injection to user placement`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user confirmation.
