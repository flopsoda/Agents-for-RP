# RisuAI Plugin Development Rules

This project targets RisuAI plugin development. Use the local reference files in
`docs/risuai/` before writing or changing plugin code.

## Target API

- Build new plugins for RisuAI Plugin API v3.0 only.
- Every plugin must declare `//@api 3.0` at the top of the plugin file.
- Do not use deprecated API 2.0 or 2.1 globals/patterns unless the user is explicitly asking to analyze or migrate legacy code.
- Prefer `docs/risuai/types/risuai.d.ts` as the source of truth for API shape. Use `docs/risuai/plugins.md` for narrative guidance.

## Required Workflow Before Plugin Code

- Before writing actual plugin code, summarize the documented RisuAI APIs that will be used.
- If a required API is not present in `docs/risuai/types/risuai.d.ts`, stop and ask instead of using internal RisuAI APIs.
- For migration work, read `docs/risuai/migrationGuide.md` first and call out any API 2.x behavior being replaced.

## API v3.0 Rules

- Treat all RisuAI API methods as asynchronous. Always use `await` or `.then()`.
- Use the documented `Risuai`/`risuai` plugin API object only.
- Use `Risuai.nativeFetch()` for network requests; do not rely on direct browser `fetch()` for external APIs.
- Use plugin iframe `document` only for plugin-owned UI.
- If main app DOM access is truly needed, use `await Risuai.getRootDocument()` and the documented SafeDocument/SafeElement APIs.
- Do not directly access the main window, main document, localStorage, IndexedDB, cookies, or internal RisuAI application APIs.
- Use documented storage APIs such as `Risuai.pluginStorage` or documented local storage wrappers instead of browser storage internals.
- `getDatabase()` may require user consent and may return `null`; handle that path explicitly.

## Prompt And Hook Rules

- For request mutation, use documented `Risuai.addRisuReplacer('beforeRequest', ...)` / `afterRequest`.
- Preserve the input/output shapes documented in the DTS for replacers and script handlers.
- Do not block chat generation on optional helper failures unless the user explicitly wants hard failure behavior.
- For long network work in hooks, use timeouts or abort signals where the API supports them.

## Git Workflow

- When a user requests a feature, bug fix, refactor, or other code change, complete the implementation, run the relevant checks, and create a git commit before finishing.
- Before committing, run `git status --short` and stage only the files intended for that change.
- Keep each commit scoped to one completed feature or fix.
- Use short, clear English commit messages that describe the change.
- Do not commit if the user explicitly says not to commit.

## Documentation Policy

- Prefer current files copied from the RisuAI GitHub repository over old Wiki pages.
- Do not rely on old Wiki syntax unless analyzing a legacy plugin.
- When docs and examples conflict, follow `docs/risuai/types/risuai.d.ts`.
- The official examples in `docs/risuai/plugins.md` are useful, but verify them against the DTS because some examples may lag behind the async v3.0 rules.

## Local References

- Plugin guide: `docs/risuai/plugins.md`
- API v3.0 DTS: `docs/risuai/types/risuai.d.ts`
- Migration guide: `docs/risuai/migrationGuide.md`
- Official starter archive: `examples/plugin_start.7z`
