# RisuAI Local References

These files were copied from the official `kwaroran/RisuAI` GitHub repository for local Codex work.

- Source repository: https://github.com/kwaroran/RisuAI
- Source commit checked locally: `358b6ae3292a278d486ae8d6154b9bc0579367b2`
- Target plugin API: RisuAI Plugin API v3.0

## Files

- `plugins.md` — current official plugin development guide.
- `types/risuai.d.ts` — current official API v3.0 type definitions; use this as the source of truth.
- `migrationGuide.md` — official migration guide for API 2.x to 3.0 work.

## Release Notes Check

Latest release checked from GitHub Releases: `v2026.4.181`, published April 18, 2026.

Latest release notes list:
- `feat: custom side bar`
- `fix: reset accumulated streaming reasoning`
- `feat: enhance popup editor with dynamic language support`
- `feat: rename coldstorage`
- `feat: enhance file removal API to support multiple file paths`

No explicit new Plugin API v3.0 breaking change was listed in the latest release notes. Recent plugin-relevant notes visible in the release history include plugin CSP changes, callback identity fixes for `removeRisuScriptHandler` / `removeRisuReplacer`, SafeElement array serialization fixes, and API additions such as `selectedPersona`, `characterOrder`, and `checkCharOrder`.

## Known Gaps

- The official TypeScript starter is distributed as `public/plugin_start.7z`; this environment did not have 7-Zip available, and Windows `tar` could not extract the LZMA archive.
- Current active lorebook extraction is not documented as a direct plugin API in the copied DTS; use documented request hooks or database APIs only.
