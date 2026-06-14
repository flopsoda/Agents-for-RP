Pending unreleased changes since v1.1.23:

- Tightened post-agent reference context guards so reference messages provide setting, prior state, and continuity only, not output formatting.
- Narrowed immediate turn context guidance so latest previous assistant responses are used for previous state and status-window values, while prose/Markdown formatting is not imitated unless it is a valid documented status-window block.
- Updated the prompt preview placeholder to describe latest previous assistant response as a status-value/state recovery source rather than an output-format source.
- Added Run Inspector copy buttons for right-side detail blocks, including prompts, responses, raw outputs, notes, memory details, warnings, and errors.
- Added copy support for full-text run log modals and stored run log bodies, using the existing body loader before copying when long text is compacted into `pluginStorage`.
- Added clipboard fallback behavior that tries `navigator.clipboard.writeText()` first, then a hidden textarea with `document.execCommand('copy')`.
- Added `.gitignore` rules so local `.env` files with API keys are ignored.
- Created local ignored `.env` placeholder for Ollama Cloud testing variables; this file is intentionally not committed.
- Added a local Ollama Cloud prompt test utility for Run Inspector prompt dumps.
- The utility can replay prompts as original, remove only context guard system messages, merge all system messages into a single leading system message, keep only the first system message, or remove generated guard system messages.
- The utility writes payload, response, content, and summary files, and reports status-window format hints plus possible previous-response leakage snippets.
- Converted pre-agent and post-agent prompts to a single leading system message with dynamic `Agents! Message Protocol` text.
- Replaced intermediate guard system messages with grouped user data blocks: `<Reference Context Blocks>`, `<Immediate Turn Context Blocks>`, and `<Task Blocks>`.
- Changed latest previous assistant guidance to recover only explicit prior-state values needed for continuity, avoiding status-window wording in the generated protocol.
- Added post-agent preservation guidance for headings, separators, and structural markers inside `<Current Response>`.

Files touched:
- `.gitignore`
- `risu_agents.js`
- `scripts/test_ollama_prompt.py`

Checks run:
- `git diff --check`
- `git check-ignore -v .env`
- `git status --short --ignored .gitignore .env`
- `rg -n "formatting|last known output format|reference context only|valid documented status-window block|status-window values|직전 출력 형식|상태창 값" risu_agents.js`
- `rg -n "copyTextToClipboard|copyTextFromButton|copyRunLogTextFromButton|bindInlineCopyButtons|data-run-log-copy-field|data-copy-target-id|modal-head-actions" risu_agents.js`
- JXA syntax compile with `new Function(...)`
- Perl static post-agent guard assertion
- Perl static Run Inspector copy assertion
- `python3 -m py_compile scripts/test_ollama_prompt.py`
- `python3 scripts/test_ollama_prompt.py --help`
- `python3 scripts/test_ollama_prompt.py /Users/flopsoda/.codex/attachments/f73687ea-ab01-4fc5-b409-781a1d87f16c/pasted-text.txt --mode no-context-guards --dry-run --out-dir /tmp`
- `python3 scripts/test_ollama_prompt.py /Users/flopsoda/.codex/attachments/f73687ea-ab01-4fc5-b409-781a1d87f16c/pasted-text.txt --mode single-system --dry-run --out-dir /tmp`
- JXA syntax compile after single-system prompt refactor with `new Function(...)`
- `rg -n "referenceContextGuard|immediateTurnContextGuard|agentTaskGuard|status-window values|existing status-window values|상태창 값|직전 출력 형식|messages\\.push\\(\\{ role: 'system'" risu_agents.js` returned no matches
- Perl static `buildAgentPrompt()` shape assertion: exactly one system role, no system push, group wrappers present, assistant prefill preserved
- `rg -n "Agents! Message Protocol|Reference Context Blocks|Immediate Turn Context Blocks|Task Blocks|explicit prior-state values|명시적 직전 상태값|Preserve existing headings|Do not output group wrapper tags" risu_agents.js`
- Created `/tmp/risu_new_single_system_grouped_prompt_v2.txt` as a grouped single-system Run Inspector prompt sample and ran `python3 scripts/test_ollama_prompt.py /tmp/risu_new_single_system_grouped_prompt_v2.txt --mode original --out-dir /tmp`
- Gemini/Ollama grouped single-system sample produced `# 승인됨`, `## 기록`, zero Markdown status headers, one `[Date: ...]` line, and no previous-response leakage hints

Checks not run:
- Manual RisuAI Run Inspector/debug log verification was not run.
- Manual clipboard verification inside the RisuAI iframe was not run.

Commits:
- `b265ef5` Tighten post-agent context formatting guards
- `746b43c` Add Run Inspector copy buttons
- `962fb5a` Ignore local env files
- `8dd988d` Add Ollama prompt test utility
- `bb1459d` Use single-system agent prompts

Release status:
- Version bump, tag, push, and GitHub Release intentionally skipped until the user requests release.
