Pending unreleased changes since v1.1.14:

- Documented GitHub Release publishing fallbacks to avoid `gh`/OS-specific delays.
  - Files touched: `AGENTS.md`
  - What changed: clarified that the Windows `gh.exe` path should only be used when it exists on Windows worktrees, and added fallback release publishing via macOS `osxkeychain` git credentials or `GH_TOKEN`/`GITHUB_TOKEN` with the GitHub Releases REST API.
  - Tests/checks: `git diff --check`
  - Commit: `f0b9169 Document GitHub release fallbacks`
  - Release status: version bump, tag, push, and GitHub Release intentionally skipped; this is an unreleased documentation-only change.
