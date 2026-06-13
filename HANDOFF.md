Pending unreleased changes since v1.1.19:

- Changed prompt section boundaries from `[Name]` headers to closed `<Name>...</Name>` blocks for setting, context, memory, current response, and agent instruction sections.
- Narrowed the default polish post-agent output contract from "full revised response" to "full revised current response".
- Files touched: `risu_agents.js`.
- Checks run:
  - `rg -n "Recent Conversation|Current Response|full revised response|full revised current response|AGENT_NOTE|MEMORY_UPDATE" risu_agents.js`
  - `rg -n "\[(Character Description|User Description|Author's Note|Active Lorebooks|Global Note Replacement|Recent Conversation|Current User Input|Pre-Agent Notes|Previous Agent Notes|Previous Memory|Memory Instruction|Memory Format|Current Response|Post-processing Instruction|Current Agent Instruction)\]" risu_agents.js`
  - `git diff --check`
  - Node REPL `vm.Script` syntax compile for `risu_agents.js`
- Check not run: `node --check risu_agents.js` because `node` is not on PATH in this shell.
- Commit: `cfe23f4` - `Wrap agent prompt sections with closing tags`.
- Release status: version bump, tag, push, and GitHub Release intentionally skipped pending user release confirmation.
