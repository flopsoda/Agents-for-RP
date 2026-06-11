Pending unreleased changes since v1.1.16:

- Accept angle-bracket memory tags
  - What changed: Memory parsing now accepts both canonical `[AGENT_NOTE]` / `[MEMORY_UPDATE]` tags and XML-style `<AGENT_NOTE>` / `<MEMORY_UPDATE>` tags. Missing `AGENT_NOTE` close recovery also supports both tag styles.
  - Files touched: `risu_agents.js`
  - Checks run: Node-backed REPL dynamic import check passed; parser sanity checks passed for square tags, angle tags, mixed tag styles, angle-style recovery, and malformed memory close failure.
  - Checks not run: `node --check risu_agents.js` could not be run because `node` is not available on PATH in this shell.
  - Commit: `47de84b Accept angle-bracket memory tags`
  - Release status: Version bump, tag, push, and GitHub Release intentionally skipped pending user confirmation.

- Prefer bound persona descriptions
  - What changed: Setting blocks now resolve `[User Description]` from the current chat's bound persona before falling back to the selected/default persona. Persona lookup by `id` or `name` is shared with existing `{{user}}` and CBS user-name paths, and debug logs now include the persona source.
  - Files touched: `risu_agents.js`
  - Checks run: Node-backed REPL helper checks passed for bound persona by id, bound persona by name, no binding fallback, missing binding fallback, and null database fallback; Node-backed `vm.Script` parse of `risu_agents.js` passed.
  - Checks not run: `node --check risu_agents.js` could not be run because `node` is not available on PATH in this shell.
  - Commit: `da34c49 Prefer bound persona descriptions`
  - Release status: Version bump, tag, push, and GitHub Release intentionally skipped pending user confirmation.
