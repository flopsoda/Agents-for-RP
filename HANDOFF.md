Pending unreleased changes since v1.1.12:

- Clarified the Agent Editor setting info toggle label to show that it includes character, persona, author's note, and active lorebook context.
  - Files touched: `risu_agents.js`
  - Tests/checks run: `rg -n "설정 정보 포함" risu_agents.js`; `git diff --check`
  - Checks not run: `node --check risu_agents.js` could not run because `node` is not on PATH.
  - Commit: `a6f93c3 Clarify setting info toggle label`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user confirmation.
