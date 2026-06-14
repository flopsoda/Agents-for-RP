Pending unreleased changes since v1.1.23:

- Tightened post-agent reference context guards so reference messages provide setting, prior state, and continuity only, not output formatting.
- Narrowed immediate turn context guidance so latest previous assistant responses are used for previous state and status-window values, while prose/Markdown formatting is not imitated unless it is a valid documented status-window block.
- Updated the prompt preview placeholder to describe latest previous assistant response as a status-value/state recovery source rather than an output-format source.

Files touched:
- `risu_agents.js`

Checks run:
- `git diff --check`
- `rg -n "formatting|last known output format|reference context only|valid documented status-window block|status-window values|직전 출력 형식|상태창 값" risu_agents.js`
- JXA syntax compile with `new Function(...)`
- Perl static post-agent guard assertion

Checks not run:
- Manual RisuAI Run Inspector/debug log verification was not run.

Commits:
- `b265ef5` Tighten post-agent context formatting guards

Release status:
- Version bump, tag, push, and GitHub Release intentionally skipped until the user requests release.
