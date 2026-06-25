# Pending unreleased changes

## Release version safeguards

- What changed: Required release updates to keep `//@version` and `PLUGIN_VERSION` synchronized and verified before commit.
- Files touched: `AGENTS.md`
- Tests/checks: `git diff --check`; reviewed the release workflow wording.
- Commit: `581a7ac Require synchronized release versions`
- Release status: Documentation-only change; plugin version bump, tag, push, and GitHub Release intentionally skipped.

## User-facing explanation guidance

- What changed: Added communication rules requiring behavior-first explanations for non-code-facing users and discouraging leading with internal function or variable names.
- Files touched: `AGENTS.md`
- Tests/checks: `git diff --check`
- Commit: `e84fda9 Add user-facing explanation guidance`
- Release status: Documentation-only change; plugin version bump, tag, push, and GitHub Release intentionally skipped.
