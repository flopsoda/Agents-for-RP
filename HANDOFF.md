Pending unreleased changes since v1.1.20:

- Changed main-model pre-agent note injection to wrap the whole helper context in `<Agents! Analysis Context>...</Agents! Analysis Context>` while keeping internal `[Row ...]` and `[Check Instruction]` labels.
- Changed memory agent output instructions to require `<AGENT_NOTE>...</AGENT_NOTE>` and `<MEMORY_UPDATE>...</MEMORY_UPDATE>`.
- Simplified memory parsing to strict angle-tag output only, removing bracket-tag tolerance, missing-note-close recovery, and the `format-recovered` status.
- Files touched: `risu_agents.js`.
- Checks run:
  - `rg -n "Agents! Analysis Context|\[Agents! Analysis Context\]|Check Instruction|AGENT_NOTE|MEMORY_UPDATE|\[AGENT_NOTE\]|\[/AGENT_NOTE\]|\[MEMORY_UPDATE\]|\[/MEMORY_UPDATE\]|format-recovered|recoverMissingMemoryNoteClose|findMemoryTagMatch|\[Memory Format\]" risu_agents.js`
  - `git diff --check`
  - Node REPL `vm.Script` syntax compile for `risu_agents.js`
  - Node REPL parser scenarios for valid angle tags, bracket tags, missing close tag, outside text, and reversed tag order
  - Node REPL sample for main-model injection block shape
- Commit: `1939263` - `Tighten prompt and memory tag boundaries`.
- Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user release confirmation.
