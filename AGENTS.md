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

## Implementation Requests

- Only implement code changes when the user explicitly asks for code implementation, a feature, a bug fix, a refactor, or another concrete code change.
- If the user is asking a question, brainstorming, or discussing possibilities without asking for implementation, answer or discuss first instead of editing code.

## Communication With Users

- When explaining behavior or planned changes to non-code-facing users, describe the user-visible flow, settings, prompts, and data that will be added or changed.
- Do not lead with internal function names, variable names, or file-level implementation details unless the user explicitly asks for code-level explanation.
- If code references are necessary, first explain the behavior in plain language, then mention the code location as supporting detail.

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
- On this machine, GitHub CLI may not be on PATH. Use the absolute path
  `C:\Program Files\GitHub CLI\gh.exe` when running `gh` commands only on Windows
  worktrees where that path exists. On macOS/Linux worktrees, do not spend time
  looking for that Windows path beyond a quick existence check.

## Release / Update Workflow

- After completing and committing a code change, ask the user whether this change should be released as a plugin update.
- If the user says yes:
  - Update both the `//@version` metadata and the `PLUGIN_VERSION` constant in
    `risu_agents.js` to the same target version. The settings badge and load log
    use `PLUGIN_VERSION`.
  - Before committing the release, verify that `//@version` and
    `PLUGIN_VERSION` exactly match.
  - Keep `//@name risu_agents` unchanged.
  - Keep existing `//@arg` keys unchanged unless the user explicitly requests a migration.
  - Commit the version bump as a separate release commit.
  - Push the commits to GitHub.
  - Create and push a git tag matching the plugin version, prefixed with `v` (for example, `v1.1.4`).
  - Create or update a GitHub Release for that tag using GitHub CLI.
    - Prefer `gh release create <tag> --title <tag> --notes-file <file> --target main` for a new release.
    - If the release already exists, use `gh release edit <tag> --title <tag> --notes-file <file>`.
    - Write concise release notes from the commits since the previous plugin version, with user-facing sections such as `Added`, `Changed`, `Fixed`, and `Notes`.
    - Include any migration or setting-loss warning that users need before updating.
  - If `gh` is unavailable, do not stop after checking PATH. Try these release
    publishing fallbacks in order:
    1. On Windows, if `C:\Program Files\GitHub CLI\gh.exe` exists, use it.
    2. On macOS, if `git config --get credential.helper` includes `osxkeychain`,
       use `git credential fill` for `https://github.com` and call the GitHub
       Releases REST API with `curl`/`jq` to create or update the release.
       Never print the credential or token.
    3. If a `GH_TOKEN` or `GITHUB_TOKEN` environment variable is set, use it with
       the GitHub Releases REST API. Never print the token.
  - If no authenticated release mechanism is available, still push the commit
    and tag, then report the blocker and provide the exact release notes text
    for manual publishing.
  - In the final response after a release, include a very short, plain-language
    community announcement blurb that summarizes the update and encourages users
    to update when the change is important. Keep it easy to copy into a community
    post.
- If the user says no, do not change `//@version` and do not push unless the user explicitly asks.

## Handoff Summary Workflow

- Maintain root-level `HANDOFF.md` as the canonical handoff summary for unreleased work.
- At the start of any feature, bug fix, refactor, documentation update, or release task:
  - Read `HANDOFF.md` if it exists.
  - Inspect recent git history with `git log --oneline` so unreleased commits are not dropped.
- If `HANDOFF.md` is missing but the user provides a previous handoff summary, create `HANDOFF.md` from that summary before finishing the change.
- After completing and committing a concrete project change:
  - Update `HANDOFF.md` by preserving prior unreleased entries and appending the new completed work.
  - Commit the `HANDOFF.md` update as a separate documentation commit unless the user explicitly says not to commit.
  - Handoff maintenance commits do not need to list their own commit hash in `HANDOFF.md`; avoid recursive handoff-only commits.
- In final responses after concrete changes, include the current `HANDOFF.md` contents inside a Markdown code block instead of generating a fresh summary that may omit prior unreleased changes.
- Keep `HANDOFF.md` concise, but include:
  - What changed
  - Files touched
  - Tests/checks run and any checks that could not be run
  - Commit hash/message if a commit was created
  - Release status, including whether version bump, tag, push, or GitHub Release was intentionally skipped
- During release/update workflow:
  - Use `HANDOFF.md` as the source for release notes.
  - In the version bump release commit, reset `HANDOFF.md` to an empty/no-pending state such as `No pending unreleased changes since vX.Y.Z`.
  - Tag the release commit after the reset is included.

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
