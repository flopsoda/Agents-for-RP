Pending unreleased changes since v1.1.22:

- Split agent prompts into separate context/task user messages so long Recent Conversation context is less likely to be mistaken for the current task target.
- Moved Current User Input, previous/pre-agent notes, memory task sections, and current agent/post-processing instructions into the task message; post-agents now receive Current Response in that final task message.
- Tightened polish post-processing contract so only `<Current Response>...</Current Response>` is editable and `<Recent Conversation>` is context only.
- Separated user-defined agent system prompts from plugin I/O contracts by inserting hardcoded system guard messages before reference-context and task-input user messages.
- Added Agent Editor help text and placeholders that explain `System Prompt` as role/style/rule criteria and `Output Instruction` as the current task instruction.
- Updated default post-agent system/output prompts for role separation, while migrating only exact legacy default strings and preserving custom prompts.

Files touched:
- `risu_agents.js`

Checks run:
- `git diff --check`
- `rg -n "contextSections|taskSections|Current Response|Post-processing Instruction|Current Agent Instruction" risu_agents.js`
- `rg -n "The only editable target|Recent Conversation" risu_agents.js`
- `rg -n "reference context only|actual post-processing task|actual pre-processing task|System Prompt|Output Instruction" risu_agents.js`
- `rg -n "DEFAULT_OUTPUT_POST_POLISH|LEGACY_DEFAULT_OUTPUT_POST_POLISH|LEGACY_DEFAULT_POST_SYSTEM_PROMPT|defaultSystemPromptForMode|normalizeAgentSystemPrompt|normalizeAgentOutputInstruction|referenceContextGuard|agentTaskGuard" risu_agents.js`
- JXA syntax compile with `new Function(...)`
- Perl static prompt split assertions
- Perl static prompt guard assertions
- Perl static prompt message order assertions

Checks not run:
- Node `node --check` / `vm.Script` checks could not run because `node` is not available on PATH.
- Manual Run Inspector/debug log verification was not run.

Commits:
- `89ff5ed` Split agent prompts into context and task messages
- `645624f` Separate agent prompt roles with guard messages

Release status:
- Version bump, tag, push, and GitHub Release intentionally skipped until the user requests release.
