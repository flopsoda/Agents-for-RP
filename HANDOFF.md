Pending unreleased changes since v1.1.24:

- Added a post-agent-only warning badge next to the Agent Editor title so users know post-processing agents are harder to tune and more prompt-sensitive than pre-agents.
  - Files touched: `risu_agents.js`
  - Tests/checks: `git diff --check`; Node-backed REPL syntax compile of `risu_agents.js`
  - Could not run: `node --check risu_agents.js` because `node` is not available on PATH in this shell
  - Commit: `bcf24bd Add post-agent editor warning badge`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval

- Added a draft Markdown prompt document that separates the Skyrim post-processing agent's customizable system prompt, read-only hardcoded prompt reference, and customizable output instruction so the editable prompt text can be discussed alongside the plugin-appended protocol. Cleaned up the customizable system prompt heading structure without removing prompt content, and renamed the player sheet section to `Player Status Window` under a shared `Status Windows` section.
  - Files touched: `docs/skyrim_post_agent_prompt_draft.md`
  - Tests/checks: `git diff --check`; `sed -n '1,260p' docs/skyrim_post_agent_prompt_draft.md`; `rg -n "Character Sheet|Journal Interface|Player Character Status|Status Windows|Player Status Window|Follower Status Window" docs/skyrim_post_agent_prompt_draft.md`
  - Commits: `b09524f Add Skyrim post-agent prompt draft`; `aeb02b5 Limit Skyrim prompt draft to customizable text`; `bc40991 Add read-only hardcoded post-agent prompt reference`; `0f57951 Clean up Skyrim prompt draft structure`; `1ae131f Rename player status prompt section`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval
