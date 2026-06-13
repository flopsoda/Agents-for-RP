Pending unreleased changes since v1.1.22:

- Split agent prompts into separate context/task user messages so long Recent Conversation context is less likely to be mistaken for the current task target.
- Moved Current User Input, previous/pre-agent notes, memory task sections, and current agent/post-processing instructions into the task message; post-agents now receive Current Response in that final task message.
- Tightened polish post-processing contract so only `<Current Response>...</Current Response>` is editable and `<Recent Conversation>` is context only.

Files touched:
- `risu_agents.js`

Checks run:
- `git diff --check`
- `rg -n "contextSections|taskSections|Current Response|Post-processing Instruction|Current Agent Instruction" risu_agents.js`
- `rg -n "The only editable target|Recent Conversation" risu_agents.js`
- JXA syntax compile with `new Function(...)`
- Perl static prompt split assertions

Checks not run:
- Node `node --check` / `vm.Script` checks could not run because `node` is not available on PATH.
- Manual Run Inspector/debug log verification was not run.

Commits:
- `89ff5ed` Split agent prompts into context and task messages

Release status:
- Version bump, tag, push, and GitHub Release intentionally skipped until the user requests release.
