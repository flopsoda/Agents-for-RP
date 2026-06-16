Pending unreleased changes since v1.1.24:

- Added a post-agent-only warning badge next to the Agent Editor title so users know post-processing agents are harder to tune and more prompt-sensitive than pre-agents.
  - Files touched: `risu_agents.js`
  - Tests/checks: `git diff --check`; Node-backed REPL syntax compile of `risu_agents.js`
  - Could not run: `node --check risu_agents.js` because `node` is not available on PATH in this shell
  - Commit: `bcf24bd Add post-agent editor warning badge`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval
