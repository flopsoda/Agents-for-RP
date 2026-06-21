# Pending unreleased changes since v1.1.26

## Exclude Risu thought blocks from agent context

- What changed: Agents! now removes complete, exact-case `<Thoughts>...</Thoughts>` blocks when copying stored chat, virtual first-message, and fallback request content into its internal context. Multiple and nested blocks are supported; malformed or differently named tags are preserved. Original chats, run logs, and existing agent memory are not modified.
- Files touched: `risu_agents.js`
- Checks: `node --check risu_agents.js`; 13 direct thought-filter and ingress fixtures; downstream history/latest-response simulation with source-mutation guard; `git diff --check`.
- Commit: `e661a6d Exclude Risu thought blocks from agent context`
- Release status: Unreleased. Version bump, tag, push, and GitHub Release intentionally skipped pending user confirmation. Existing memory that may already contain reasoning-derived notes is not cleared automatically.
