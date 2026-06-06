## Handoff Summary

Project: `/Users/flopsoda/Documents/Projects/Agents-for-RP`

Recent completed changes:
- Improved the custom Provider URL input UX in `risu_agents.js`.
  - Changed the custom Provider URL label from `Endpoint Base URL` to `API Base URL`.
  - Added placeholder `https://api.example.com/v1`.
  - Added help text telling users not to enter `/chat/completions`, `/models`, or `/messages` because Agents! appends those paths automatically.
  - Did not add automatic correction, validation blocking, warnings, or request behavior changes.
- Added `Handoff Summary Workflow` to `AGENTS.md`.
  - Future agents should preserve/update previous handoff summaries after completed project changes.
  - Future summaries should be written inside a Markdown code block and include changes, files touched, checks, commits, and release status.
- Fixed post-agent prompt context assembly in `risu_agents.js`.
  - Added transient `lastPipelineContext` so post-agents reuse the same request's `chatContext`, `runContext`, and `userInput`.
  - Made `최근 대화 포함` and `현재 유저 입력 포함` work for post-agents as well as pre-agents.
  - Passed post-agent-specific history with each agent preset's `contextWindow`.
  - Changed lore/settings scan max window from pre-agent-only to all enabled pre/post agents.
  - Kept pre-agent reuse key history logic pre-agent-only, so post-agent settings do not invalidate pre-agent reuse.
  - Did not store full chat history in Run Log/pluginStorage.
- Made `HANDOFF.md` the canonical unreleased handoff summary in `AGENTS.md`.
  - Future agents should read `HANDOFF.md` and recent git history before feature, fix, refactor, documentation, or release tasks.
  - Future agents should update `HANDOFF.md` after committed concrete changes and commit that update separately.
  - Release workflow should use `HANDOFF.md` for release notes, then reset it in the version bump release commit.
  - Handoff maintenance commits do not need to list their own commit hash to avoid recursive handoff-only commits.
- Updated Google provider naming in `risu_agents.js` from standalone `Vertex AI` labels to `Agent Platform (구 Vertex AI)`.
  - Changed the provider dropdown label to `Agent Platform (구 Vertex AI)`.
  - Changed the default Vertex provider preset name to `Agent Platform Gemini`.
  - Updated the `agents_base_url` argument help text, credential toast, API/Base URL/access-token/WebCrypto error text, and debug log labels.
  - Kept provider IDs, aliases, function/variable names, endpoint URLs, authentication flow, model defaults, and `//@version 1.1.11` unchanged.
  - Checked `docs/risuai/types/risuai.d.ts` and `docs/risuai/plugins.md`; no new RisuAI API was needed.

Files touched:
- `risu_agents.js`
- `AGENTS.md`
- `HANDOFF.md`

Validation:
- For custom Provider URL UX:
  - `git diff --check -- risu_agents.js` passed.
  - JavaScriptCore check passed with:
    `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc --ignoreUncaughtExceptions risu_agents.js`
  - `node --check risu_agents.js` could not be run because `node` is not on PATH.
- For original `AGENTS.md` handoff workflow:
  - `git diff --check -- AGENTS.md` passed.
- For post-agent prompt context fix:
  - `git diff --check -- risu_agents.js AGENTS.md` passed.
  - JavaScriptCore check passed with:
    `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc --ignoreUncaughtExceptions risu_agents.js`
  - `node --check risu_agents.js` could not be run because `node` is not on PATH.
- For persistent `HANDOFF.md` workflow:
  - `git diff --check -- AGENTS.md` passed.
  - `git diff --check -- AGENTS.md HANDOFF.md` passed.
- For Agent Platform label update:
  - `rg -n "Vertex AI|Vertex Gemini|Vertex chat|Vertex token|Agent Platform" risu_agents.js` showed `Vertex AI` only in the intended `Agent Platform (구 Vertex AI)` compatibility label.
  - `git diff --check -- risu_agents.js HANDOFF.md` passed.
  - JavaScriptCore check passed with:
    `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc --ignoreUncaughtExceptions risu_agents.js`
  - `node --check risu_agents.js` could not be run because `node` is not on PATH.

Commits:
- `13583a1 Clarify custom provider base URL help`
- `4f456c1 Add handoff summary workflow`
- `7abd1fd Fix post-agent prompt context assembly`
- `2b80a80 Use persistent handoff summary file`
- `4254b29 Update Agent Platform labels`

Release status:
- User previously said not to release yet.
- No version bump, tag, push, or GitHub Release was created for these changes.
- Release/update is still pending user decision.
