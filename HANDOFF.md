Pending unreleased changes since v1.1.24:

- Added a post-agent-only warning badge next to the Agent Editor title so users know post-processing agents are harder to tune and more prompt-sensitive than pre-agents.
  - Files touched: `risu_agents.js`
  - Tests/checks: `git diff --check`; Node-backed REPL syntax compile of `risu_agents.js`
  - Could not run: `node --check risu_agents.js` because `node` is not available on PATH in this shell
  - Commit: `bcf24bd Add post-agent editor warning badge`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval

- Added a draft Markdown prompt document that separates the Skyrim post-processing agent's customizable system prompt, read-only hardcoded prompt reference, and customizable output instruction so the editable prompt text can be discussed alongside the plugin-appended protocol. Cleaned up the customizable system prompt heading structure without removing prompt content, renamed the player sheet section to `Player Status Window` under a shared `Status Windows` section, normalized the editable prompt text to English, moved output execution rules into the customizable output instruction, and added narrator examples plus output rules for explicit resource recovery over time/rest/sleep.
  - Files touched: `docs/skyrim_post_agent_prompt_draft.md`
  - Tests/checks: `git diff --check`; `sed -n '1,260p' docs/skyrim_post_agent_prompt_draft.md`; `rg -n "Character Sheet|Journal Interface|Player Character Status|Status Windows|Player Status Window|Follower Status Window" docs/skyrim_post_agent_prompt_draft.md`; `rg -n "[가-힣]" docs/skyrim_post_agent_prompt_draft.md`; `rg -n "placed|Before a character|must comment|Current Response|Output Instruction|Player Status Window|Follower Status Window" docs/skyrim_post_agent_prompt_draft.md`; `rg -n "Recovery|recovery|rest|sleep|Resource Use/Resource Change|Stamina Recovery|Magicka Recovery|Multiple Resource" docs/skyrim_post_agent_prompt_draft.md`
  - Commits: `b09524f Add Skyrim post-agent prompt draft`; `aeb02b5 Limit Skyrim prompt draft to customizable text`; `bc40991 Add read-only hardcoded post-agent prompt reference`; `0f57951 Clean up Skyrim prompt draft structure`; `1ae131f Rename player status prompt section`; `6e7523d Move post-agent output rules into instruction`; `e187cfd Add resource recovery narrator examples`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user approval
