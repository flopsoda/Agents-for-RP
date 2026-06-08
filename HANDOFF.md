Pending unreleased changes since v1.1.14:

- Documented GitHub Release publishing fallbacks to avoid `gh`/OS-specific delays.
  - Files touched: `AGENTS.md`
  - What changed: clarified that the Windows `gh.exe` path should only be used when it exists on Windows worktrees, and added fallback release publishing via macOS `osxkeychain` git credentials or `GH_TOKEN`/`GITHUB_TOKEN` with the GitHub Releases REST API.
  - Tests/checks: `git diff --check`
  - Commit: `f0b9169 Document GitHub release fallbacks`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped; this is an unreleased documentation-only change.

- Strengthened the Main Model default check instruction.
  - Files touched: `risu_agents.js`
  - What changed: changed the default Row 5 `검수 지침` to `위 분석 노트들을 반드시 반영하여 최종 RP 응답을 작성하세요.` Existing saved settings that exactly match the previous default are normalized to the new default; custom check instructions are preserved.
  - Tests/checks: `git diff --check`; syntax check via Node-backed REPL `vm.Script` passed. `node --check risu_agents.js` could not run because `node` is not on PATH.
  - Commit: `32ae86b Strengthen main model check instruction`
  - Release status: version bump, tag, push, and GitHub Release pending.
