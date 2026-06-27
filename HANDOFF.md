# Pending unreleased changes

## Character pipeline pins

- What changed: Added per-character Pipeline Preset pinning. The settings UI now shows the current character dynamically, lets users pin/change/unpin the active Pipeline Preset for that character, widens the desktop settings container, and applies a valid character pin before falling back to the global active preset. `afterRequest` reuses the pipeline selected during `beforeRequest` so pre/post stages stay on the same preset.
- Files touched: `risu_agents.js`.
- Tests/checks run: `node --check risu_agents.js`; `git diff --check`.
- Commit: `d42ba63 Add character pipeline pins`.
- Release status: Version bump, tag, push, and GitHub Release intentionally skipped until the user asks to release this as a plugin update.
