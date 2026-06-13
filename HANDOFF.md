Pending unreleased changes since v1.1.21:

- Updated release workflow instructions to require a very short, plain-language community announcement blurb in final responses after releases, especially when updates are important.
- Updated the hardcoded polish post-processing output contract to preserve Current Response content unless the post-processing instruction explicitly requires changes, preventing unstated summarization, condensation, omission, expansion, continuation, or reinterpretation.
- Files touched: `AGENTS.md`, `risu_agents.js`.
- Checks run:
  - `rg -n "Only change what the post-processing instruction explicitly require|full revised current response|Do not summarize|Do not output analysis notes" risu_agents.js`
  - `git diff --check`
  - Node REPL `vm.Script` syntax compile for `risu_agents.js`
- Commit: `af51859` - `Document community release blurbs`.
- Commit: `72d9bcc` - `Preserve content in polish post-processing`.
- Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user release confirmation.
