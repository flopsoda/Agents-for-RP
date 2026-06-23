# Pending unreleased changes

## Release version safeguards

- What changed: Required release updates to keep `//@version` and `PLUGIN_VERSION` synchronized and verified before commit.
- Files touched: `AGENTS.md`
- Tests/checks: `git diff --check`; reviewed the release workflow wording.
- Commit: `581a7ac Require synchronized release versions`
- Release status: Documentation-only change; plugin version bump, tag, push, and GitHub Release intentionally skipped.
