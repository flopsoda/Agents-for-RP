Pending plugin release changes since v1.1.25:

Use only this section as input for the next plugin release notes.

- Updated the post-agent-only warning badge to tell users to keep agent context at 2~3 and turn off RisuAI streaming for smoother post-processing behavior. The badge remains visible guidance only and does not change either setting automatically.
  - Files touched: `risu_agents.js`
  - Tests/checks: `node --check risu_agents.js`; `git diff --check`; `rg` verification of the exact visible text, post-agent-only condition, and absence of a tooltip
  - Commit: `0dd9b77 Add streaming guidance to post-agent badge`
  - Release status: scheduled for v1.1.26
