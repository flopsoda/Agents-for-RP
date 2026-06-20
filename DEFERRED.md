# Deferred Work

This file tracks project work that has been intentionally postponed. Add future
items here instead of creating one-off deferred-plan files.

## Maintenance Rules

- Give each item a clear status, background, reason for deferral, and resume condition.
- Record the intended implementation, non-goals, and validation requirements.
- Keep deferred items until they are implemented, rejected, or superseded.
- When work resumes, update the item rather than recreating its context elsewhere.

## Deferred Items

### Adopt the Official RisuAI Lorebook Candidate API

- Status: Deferred
- Recorded: 2026-06-20
- Resume condition: The user explicitly requests implementation after the relevant RisuAI API behavior is considered stable.

#### Background

RisuAI `v2026.6.100` added the asynchronous Plugin API v3.0 method
`getCurrentLorebookEntries()`. It returns a snapshot containing raw lorebook
entries from the current character or group, the current chat, and currently
active modules.

`risu_agents.js` currently gathers the same candidate categories manually from
`getCharacter()`, `getChatFromIndex()`, and database module data. It then uses
`matchActiveLorebooksLikeRisu()` to estimate which candidates are active.

#### Reason for Deferral

The new API improves candidate collection but does not expose RisuAI's exact
post-activation lorebook set. It does not perform activation-key matching,
recursive scanning, decorator processing, or token-budget filtering. Runtime
changes are deferred until the user chooses to revisit the integration after
RisuAI behavior stabilizes.

#### Planned Implementation

- Use `await Risuai.getCurrentLorebookEntries()` as the primary candidate source.
- Fall back to the current manual collection when the method is unavailable or throws.
- Treat a successful empty array as a valid result, not as a fallback condition.
- Preserve the official array order and do not add plugin-side deduplication.
- Keep `matchActiveLorebooksLikeRisu()` because the official API returns raw candidates.
- Record the candidate source as `official-api` or `legacy-fallback` in debug statistics.
- After the official path is established, review whether `modules` and `enabledModules` can be removed from the database projection.

#### Non-Goals and Cautions

- Do not describe the official API result as the exact active lorebook list.
- Do not remove the existing matcher solely because the candidate API is available.
- Do not require a newer RisuAI version without an explicit compatibility decision.
- Do not mutate returned entries with the expectation of changing host lorebooks; the result is a snapshot.

#### Validation Checklist

- Verify official API success with populated and empty lorebook sets.
- Verify fallback behavior when the method is missing and when it rejects.
- Verify character, chat, group, and active-module candidates remain available.
- Verify candidate ordering and duplicate preservation.
- Verify active-lorebook estimation and debug statistics remain functional.
- Confirm database-permission denial no longer removes module candidates when the official API succeeds.
