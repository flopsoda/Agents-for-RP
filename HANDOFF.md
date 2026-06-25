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

## Hypa Past Events Summary in agent context

- What changed: Added default-enabled per-agent inclusion of RisuAI HypaV3 `<Past Events Summary>` as a Reference Context block, updated prompt protocol block descriptions, carried the summary through pre/post agents, and included it in pre-agent reuse hashing.
- Files touched: `risu_agents.js`
- Tests/checks: `node --check risu_agents.js`; `git diff --check`; standalone extraction checks for single, wrapped, multiple, empty, and missing Past Events Summary blocks.
- Commit: `cd0fc70 Include Hypa summaries in agent context`
- Release status: Code change committed; plugin version bump, tag, push, and GitHub Release intentionally skipped pending user release decision.

## Agents protocol separator

- What changed: Changed the shared Agents! message protocol heading to `--- Agents! Message Protocol ---` so custom agent system prompts are visually separated from the plugin's protocol instructions.
- Files touched: `risu_agents.js`
- Tests/checks: `node --check risu_agents.js`; `git diff --check`; verified the separator heading is the only remaining protocol title string.
- Commit: `ffc274f Separate agent protocol heading`
- Release status: Code change committed; plugin version bump, tag, push, and GitHub Release intentionally skipped pending user release decision.

## Markdown agent protocol structure

- What changed: Reworked the shared Agents! message protocol into Markdown-style sections, code-formatted descriptive block names, and a dedicated output contract section while preserving raw output tags and the existing data block format.
- Files touched: `risu_agents.js`
- Tests/checks: `node --check risu_agents.js`; `git diff --check`; static protocol structure check for Markdown headings, code-formatted block list names, raw memory tags, raw Current Response guard text, and unchanged Past Events Summary description.
- Commit: `b47a8bb Structure agent protocol as markdown`
- Release status: Code change committed; plugin version bump, tag, push, and GitHub Release intentionally skipped pending user release decision.
