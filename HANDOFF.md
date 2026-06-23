# Pending unreleased changes

## LIBRA compatibility

- What changed: Excluded LIBRA-managed lorebooks from candidate collection, active lorebook handling, and final Agents! prompt formatting.
- Files touched: `risu_agents.js`
- Tests/checks: `node --check risu_agents.js`; targeted LIBRA filter fixtures (6 rejected, 3 ordinary lorebooks preserved); `git diff --check`.
- Commit: `2742336 Exclude LIBRA-managed lorebooks`
- Release status: Pending v1.1.28 version bump, tag, push, and GitHub Release.
