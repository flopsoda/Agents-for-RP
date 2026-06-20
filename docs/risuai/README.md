# RisuAI Local References

These files track the official `kwaroran/RisuAI` GitHub repository for local Codex work. Clearly labeled supplemental notes may be added where the upstream narrative guide lags behind the documented API.

- Source repository: https://github.com/kwaroran/RisuAI
- Source commit checked locally: `6765daa2d9503e453fcd7ee121cbf8766e3ffb24`
- Target plugin API: RisuAI Plugin API v3.0

## Files

- `plugins.md` — current official plugin development guide with clearly labeled local supplemental notes.
- `types/risuai.d.ts` — current official API v3.0 type definitions; use this as the source of truth.
- `migrationGuide.md` — official migration guide for API 2.x to 3.0 work.

## Release Notes Check

Latest release checked from GitHub Releases: `v2026.6.114`, published June 12, 2026.

Plugin-relevant release history since the previous reference check includes:

- RisuAI `v2026.6.100` added `getCurrentLorebookEntries()` to Plugin API v3.0.
- The API returns raw lorebook entries from the current character or group, current chat, and currently active modules.
- It does not apply activation matching, recursive scanning, or token budget filtering.

No Plugin API v3.0 breaking change was identified in the checked releases.

## Known Gaps

- The official TypeScript starter is distributed as `public/plugin_start.7z`; this environment did not have 7-Zip available, and Windows `tar` could not extract the LZMA archive.
- No documented Plugin API returns the exact final set of activated lorebook entries. `getCurrentLorebookEntries()` returns raw candidates, not post-activation or post-token-budget results.

## Related Project Documentation

- [DEFERRED.md](../../DEFERRED.md) tracks postponed implementation work, including adoption of the official lorebook candidate API in `risu_agents.js`.
