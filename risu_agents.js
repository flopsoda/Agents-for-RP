//@name risu_multiagent
//@display-name Agents!
//@api 3.0
//@version 1.0.0
//@arg agent_provider string Analysis agent provider label. e.g. ollama
//@arg agent_base_url string Analysis agent API base URL. e.g. https://ollama.com/v1, https://api.openai.com/v1, https://api.anthropic.com/v1, or Vertex AI OpenAI-compatible endpoint
//@arg agent_api_key string Analysis agent API key
//@arg agent_model string Analysis agent model. e.g. gemini-3-flash-preview:cloud
//@arg agent_temperature string Analysis agent temperature (default: 0.7)
//@arg agent_max_tokens string Analysis agent max tokens (blank = provider default)
//@arg context_window int Recent messages per agent (default: 10)
//@arg agent_debug_log string Print MultiAgent prompt flow to console. true/false (default: true)
//@arg agent_pipeline_json string Dynamic MultiAgent pipeline JSON
//@arg agent_model_presets_json string Model presets JSON
//@arg agent_provider_keys_json string Provider API keys JSON

/**
 * Agents! — RisuAI Plugin (Browser, API v3.0)
 *
 * 파이프라인:
 *   beforeRequest 훅
 *     → [세계관 에이전트]  nativeFetch → context_world
 *     → [플롯 에이전트]    nativeFetch → context_plot
 *     → [캐릭터 에이전트]  nativeFetch → context_char
 *     → system 프롬프트에 3개 컨텍스트 주입
 *   메인 LLM (유저 설정 모델) — 검수 에이전트 역할, 최종 응답 생성
 */

(async () => {
  try {
    let vertexTokenCache = null;
    const DEFAULT_AGENT_PROVIDER = 'ollama';
    const DEFAULT_AGENT_BASE_URL = 'https://ollama.com/v1';
    const DEFAULT_AGENT_MODEL = 'gemini-3-flash-preview:cloud';
    const DEFAULT_MODEL_PRESET_ID = 'preset-default-ollama';
    const DEFAULT_PROVIDER_ORDER = ['ollama', 'openai', 'claude', 'google', 'vertex-ai'];
    const EMPTY_AGENT_MEMORY = '(저장된 기억 없음)';
    const MEMORY_NOTE_TAG = 'AGENT_NOTE';
    const MEMORY_UPDATE_TAG = 'MEMORY_UPDATE';
    const RUN_LOG_VERSION = 1;
    const SETTINGS_UI_ID = 'risu-agents-settings';
    const HAMBURGER_UI_ID = 'risu-multiagent-lite-hamburger';
    const CHAT_UI_ID = 'risu-multiagent-lite-chat';
    const MODEL_SEED_CATALOG = {
      ollama: ['gemini-3-flash-preview:cloud', 'deepseek-v4-pro:cloud', 'deepseek-v4-flash:cloud'],
      openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
      claude: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      google: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'],
      'vertex-ai': ['google/gemini-3.1-pro-preview', 'google/gemini-3-flash-preview', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash'],
    };
    const PIPELINE_ROW_COUNT = 9;
    const MAIN_ROW_INDEX = 4;
    let lastPipelineRun = null;

    // ── 설정 로드 ─────────────────────────────────────────────────────────────

    async function getConfig() {
      const provider = (await Risuai.getArgument('agent_provider')) || DEFAULT_AGENT_PROVIDER;
      const baseUrl = normalizeUrl((await Risuai.getArgument('agent_base_url')) || DEFAULT_AGENT_BASE_URL);
      const legacyApiKey  = (await Risuai.getArgument('agent_api_key'))  || '';
      const model   = (await Risuai.getArgument('agent_model'))    || DEFAULT_AGENT_MODEL;
      const temperature = parseFloat((await Risuai.getArgument('agent_temperature')) || '0.7');
      const maxTokens = parseOptionalInt(await Risuai.getArgument('agent_max_tokens'));
      const window  = Math.max(1, parseInt((await Risuai.getArgument('context_window')) || '10') || 10);
      const debugLog = parseBool(await Risuai.getArgument('agent_debug_log'), true);
      const legacy = {
        provider,
        baseUrl,
        model,
        temperature: Number.isFinite(temperature) ? temperature : 0.7,
        maxTokens,
        window,
      };
      const providerKeys = parseProviderKeys(
        await Risuai.getArgument('agent_provider_keys_json'),
        provider,
        legacyApiKey,
        debugLog,
      );
      const modelPresets = parseModelPresets(
        await Risuai.getArgument('agent_model_presets_json'),
        legacy,
        debugLog,
      );
      const apiKey = getProviderApiKey(providerKeys, provider) || legacyApiKey;
      return {
        provider,
        baseUrl,
        apiKey,
        legacyApiKey,
        providerKeys,
        modelPresets,
        model,
        temperature: legacy.temperature,
        maxTokens,
        window,
        debugLog,
      };
    }

    // ── LLM 호출 헬퍼 ─────────────────────────────────────────────────────────

    async function callAgent(conf, messages) {
      if (isAnthropicProvider(conf.provider)) {
        return callAnthropicAgent(conf, messages);
      }
      if (isVertexProvider(conf.provider)) {
        return callVertexAgent(conf, messages);
      }
      return callOpenAICompatibleAgent(conf, messages);
    }

    function parseProviderKeys(raw, legacyProvider, legacyApiKey, debugLog) {
      const keys = {};
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.keys(parsed).forEach((key) => {
              const provider = normalizeProviderValue(key);
              const value = String(parsed[key] || '');
              if (provider && value) keys[provider] = value;
            });
          }
        } catch (err) {
          if (debugLog) console.log(`Agents! provider key JSON parse failed: ${err.message}`);
        }
      }

      const legacyKey = String(legacyApiKey || '');
      const normalizedLegacyProvider = normalizeProviderValue(legacyProvider || DEFAULT_AGENT_PROVIDER);
      if (legacyKey && normalizedLegacyProvider && !keys[normalizedLegacyProvider]) {
        keys[normalizedLegacyProvider] = legacyKey;
      }
      return keys;
    }

    function parseModelPresets(raw, legacy, debugLog) {
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw));
          const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.presets) ? parsed.presets : [];
          const presets = normalizeModelPresets(source, legacy);
          if (presets.length > 0) return presets;
        } catch (err) {
          if (debugLog) console.log(`Agents! model preset JSON parse failed: ${err.message}`);
        }
      }
      return defaultModelPresets(legacy);
    }

    function normalizeModelPresets(source, legacy) {
      const used = new Set();
      const presets = (Array.isArray(source) ? source : [])
        .map((preset, idx) => normalizeModelPreset(preset, legacy, idx, used))
        .filter(Boolean);
      return ensureDefaultProviderPresets(presets, legacy, used);
    }

    function normalizeModelPreset(preset, legacy, idx, used) {
      const fallback = legacy || {};
      const baseId = String(preset?.id || (idx === 0 ? DEFAULT_MODEL_PRESET_ID : makeAgentId('preset')));
      let id = baseId;
      while (used.has(id)) id = `${baseId}-${used.size + 1}`;
      used.add(id);

      return {
        id,
        name: String(preset?.name || (idx === 0 ? 'Ollama' : `Model Preset ${idx + 1}`)),
        provider: normalizeProviderValue(preset?.provider || fallback.provider || DEFAULT_AGENT_PROVIDER),
        baseUrl: normalizeUrl(preset?.baseUrl || fallback.baseUrl || DEFAULT_AGENT_BASE_URL),
        model: String(preset?.model || fallback.model || DEFAULT_AGENT_MODEL),
        temperature: preset?.temperature === null || preset?.temperature === undefined || preset?.temperature === ''
          ? String(fallback.temperature ?? 0.7)
          : String(preset.temperature),
        maxTokens: preset?.maxTokens === null || preset?.maxTokens === undefined ? '' : String(preset.maxTokens),
        contextWindow: preset?.contextWindow === null || preset?.contextWindow === undefined || preset?.contextWindow === ''
          ? String(fallback.window || 10)
          : String(preset.contextWindow),
      };
    }

    function defaultModelPreset(legacy) {
      return defaultModelPresets(legacy)[0];
    }

    function defaultModelPresets(legacy) {
      return DEFAULT_PROVIDER_ORDER.map((provider, idx) => defaultModelPresetForProvider(provider, legacy, idx));
    }

    function defaultModelPresetForProvider(provider, legacy, idx = 0) {
      const normalized = normalizeProviderValue(provider || DEFAULT_AGENT_PROVIDER);
      const defaults = providerDefaults(normalized) || providerDefaults(DEFAULT_AGENT_PROVIDER);
      return {
        id: normalized === DEFAULT_AGENT_PROVIDER ? DEFAULT_MODEL_PRESET_ID : `preset-default-${normalized}`,
        name: defaultPresetName(normalized),
        provider: normalized,
        baseUrl: normalizeUrl(defaults.baseUrl),
        model: String(defaults.model),
        temperature: String(legacy?.temperature ?? 0.7),
        maxTokens: legacy?.maxTokens === null || legacy?.maxTokens === undefined ? '' : String(legacy.maxTokens),
        contextWindow: String(legacy?.window || 10),
      };
    }

    function ensureDefaultProviderPresets(presets, legacy, used = null) {
      const result = Array.isArray(presets) ? presets.slice() : [];
      const idSet = used || new Set(result.map(preset => preset.id));
      const existingProviders = new Set(result.map(preset => normalizeProviderValue(preset.provider)));

      DEFAULT_PROVIDER_ORDER.forEach((provider, idx) => {
        if (existingProviders.has(provider)) return;
        const preset = defaultModelPresetForProvider(provider, legacy, idx);
        let id = preset.id;
        while (idSet.has(id)) id = `${preset.id}-${idSet.size + 1}`;
        preset.id = id;
        idSet.add(id);
        result.push(preset);
      });

      return result;
    }

    function defaultPresetName(provider) {
      const names = {
        ollama: 'Ollama',
        openai: 'OpenAI',
        claude: 'Claude',
        google: 'Google Gemini',
        'vertex-ai': 'Vertex Gemini',
      };
      return names[normalizeProviderValue(provider)] || 'Model Preset';
    }

    function getProviderApiKey(providerKeys, provider) {
      const normalized = normalizeProviderValue(provider || DEFAULT_AGENT_PROVIDER);
      return String(providerKeys?.[normalized] || '');
    }

    function findModelPreset(presets, id) {
      const list = Array.isArray(presets) ? presets : [];
      return list.find(preset => preset.id === id) || list[0] || defaultModelPreset({});
    }

    async function callOpenAICompatibleAgent(conf, messages) {
      const payload = {
        model: conf.model,
        messages,
        temperature: conf.temperature,
      };
      if (conf.maxTokens !== null) payload.max_tokens = conf.maxTokens;

      const url = `${conf.baseUrl}/chat/completions`;
      logAgentFetch(conf, 'OpenAI-compatible chat/completions start', url, payload);
      const res = await Risuai.nativeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${conf.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      logAgentFetch(conf, `OpenAI-compatible chat/completions response ${res.status}`, url);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Agent API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return data.choices[0].message.content;
    }

    async function callAnthropicAgent(conf, messages) {
      const { system, anthropicMessages } = toAnthropicMessages(messages);
      const payload = {
        model: conf.model,
        messages: anthropicMessages,
        temperature: conf.temperature,
        max_tokens: conf.maxTokens || 1024,
      };
      if (system) payload.system = system;

      const url = `${conf.baseUrl}/messages`;
      logAgentFetch(conf, 'Anthropic messages start', url, payload);
      const res = await Risuai.nativeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': conf.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
      logAgentFetch(conf, `Anthropic messages response ${res.status}`, url);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return extractAnthropicText(data);
    }

    async function callVertexAgent(conf, messages) {
      const accessToken = await getVertexAccessToken(conf.apiKey);
      const payload = {
        model: conf.model,
        messages,
        temperature: conf.temperature,
      };
      if (conf.maxTokens !== null) payload.max_tokens = conf.maxTokens;

      const url = `${conf.baseUrl}/chat/completions`;
      logAgentFetch(conf, 'Vertex chat/completions start', url, payload);
      const res = await Risuai.nativeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      logAgentFetch(conf, `Vertex chat/completions response ${res.status}`, url);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Vertex AI API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return data.choices[0].message.content;
    }

    function toAnthropicMessages(messages) {
      const systemParts = [];
      const anthropicMessages = [];
      for (const msg of messages) {
        if (msg.role === 'system') {
          if (msg.content) systemParts.push(String(msg.content));
        } else if (msg.role === 'user' || msg.role === 'assistant') {
          anthropicMessages.push({ role: msg.role, content: String(msg.content || '') });
        }
      }
      if (!anthropicMessages.length) throw new Error('Anthropic 호출에는 user 또는 assistant 메시지가 필요합니다.');
      return {
        system: systemParts.join('\n\n'),
        anthropicMessages,
      };
    }

    function extractAnthropicText(data) {
      const parts = (data.content || [])
        .filter(block => block && block.type === 'text')
        .map(block => block.text || '')
        .filter(Boolean);
      if (!parts.length) throw new Error('Anthropic 응답에서 text content를 찾을 수 없습니다.');
      return parts.join('\n').trim();
    }

    // ── 메시지 유틸 ───────────────────────────────────────────────────────────

    async function buildSettingBlocks(messages) {
      const parts = {
        characterDescription: '(캐릭터 설명 없음)',
        userDescription: '(유저 설명 접근 불가: DB 권한 없음)',
        authorNote: '(작가의 노트 없음)',
        activeLorebooks: [],
      };
      const stats = {
        character: 'missing',
        persona: 'db-null',
        authorNote: 'missing',
        loreCandidates: 0,
        activeLorebooks: 0,
      };

      let character = null;
      let db = null;

      try {
        character = await Risuai.getCharacter();
      } catch (err) {
        console.log(`Agents! setting blocks: getCharacter failed: ${err.message}`);
      }

      try {
        db = await Risuai.getDatabase(['personas', 'selectedPersona', 'modules', 'enabledModules']);
      } catch (err) {
        console.log(`Agents! setting blocks: getDatabase failed: ${err.message}`);
      }

      if (character) {
        const charDesc = firstNonEmpty(character.description, character.desc);
        if (charDesc) {
          parts.characterDescription = charDesc;
          stats.character = 'found';
        }

        const chat = getCurrentCharacterChat(character);
        const note = String(chat?.note || '').trim();
        if (note) {
          parts.authorNote = note;
          stats.authorNote = 'found';
        }
      }

      if (db) {
        const persona = getSelectedPersona(db);
        if (persona) {
          const personaPrompt = String(persona.personaPrompt || '').trim();

          if (personaPrompt) {
            parts.userDescription = personaPrompt;
            stats.persona = 'found';
          } else {
            parts.userDescription = '(유저 설명 없음)';
            stats.persona = 'missing';
          }
        } else {
          parts.userDescription = '(유저 설명 없음)';
          stats.persona = 'missing';
        }
      }

      const loreCandidates = collectLorebookCandidates(character, db);
      const activeLorebooks = matchActiveLorebooks(messages, loreCandidates);
      parts.activeLorebooks = activeLorebooks;
      stats.loreCandidates = loreCandidates.length;
      stats.activeLorebooks = activeLorebooks.length;

      return {
        content: formatSettingBlocks(parts),
        stats,
      };
    }

    function getUserInput(messages) {
      const userMsgs = messages.filter(m => m.role === 'user');
      return userMsgs.length ? userMsgs[userMsgs.length - 1].content : '';
    }

    function formatHistory(messages, windowSize) {
      // 마지막 유저 메시지를 제외한 최근 N개
      const chatMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
      const recent = chatMsgs.slice(-(windowSize + 1), -1);
      if (!recent.length) return '(대화 히스토리 없음)';
      return recent.map(m => `[${m.role === 'user' ? '유저' : 'AI'}]: ${m.content}`).join('\n');
    }

    function firstNonEmpty(...values) {
      for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
      }
      return '';
    }

    function getCurrentCharacterChat(character) {
      const chats = Array.isArray(character?.chats) ? character.chats : [];
      if (!chats.length) return null;
      const page = Number.isInteger(character.chatPage) ? character.chatPage : 0;
      return chats[page] || chats[0] || null;
    }

    function getSelectedPersona(db) {
      const personas = Array.isArray(db?.personas) ? db.personas : [];
      if (!personas.length) return null;

      const selected = db?.selectedPersona;
      if (Number.isInteger(selected) && personas[selected]) {
        return personas[selected];
      }

      if (typeof selected === 'string') {
        return personas.find(persona => persona?.id === selected || persona?.name === selected) || personas[0];
      }

      return personas[0];
    }

    function collectLorebookCandidates(character, db) {
      const candidates = [];
      const seen = new Set();

      const addLore = (lore, sourcePrefix) => {
        if (!lore) return;
        const content = firstNonEmpty(lore.content, lore.prompt, lore.text, lore.entry);
        if (!content) return;
        const label = firstNonEmpty(lore.comment, lore.name, lore.displayName, sourcePrefix, '로어북');
        const key = normalizeForMatch(`${label}\n${content}`);
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ label, content });
      };

      if (character) {
        if (Array.isArray(character.globalLore)) {
          character.globalLore.forEach(lore => addLore(lore, '캐릭터 로어북'));
        }

        const chat = getCurrentCharacterChat(character);
        if (Array.isArray(chat?.localLore)) {
          chat.localLore.forEach(lore => addLore(lore, '채팅 로어북'));
        }
      }

      const modules = Array.isArray(db?.modules) ? db.modules : [];
      const enabled = Array.isArray(db?.enabledModules) ? new Set(db.enabledModules.map(String)) : new Set();
      for (const module of modules) {
        const moduleEnabled =
          enabled.has(String(module?.id)) ||
          enabled.has(String(module?.name)) ||
          enabled.has(String(module?.namespace));
        if (!moduleEnabled || !Array.isArray(module?.lorebook)) continue;
        module.lorebook.forEach(lore => addLore(lore, `모듈 로어북: ${module.name || module.id || 'unknown'}`));
      }

      return candidates;
    }

    function matchActiveLorebooks(messages, candidates) {
      if (!candidates.length) return [];

      const requestText = normalizeForMatch(
        messages
          .map(msg => String(msg?.content || ''))
          .filter(Boolean)
          .join('\n\n')
      );

      if (!requestText) return [];

      return candidates.filter(candidate => candidateContentMatchesRequest(requestText, candidate.content));
    }

    function normalizeForMatch(text) {
      return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    function candidateContentMatchesRequest(requestText, content) {
      const normalizedContent = normalizeForMatch(content);
      if (normalizedContent && requestText.includes(normalizedContent)) return true;

      const strippedContent = normalizeForMatch(stripLoreDirectives(content));
      if (strippedContent && requestText.includes(strippedContent)) return true;

      const meaningfulSegments = String(content || '')
        .split(/\{\{[^{}]+\}\}/g)
        .map(normalizeForMatch)
        .filter(segment => segment.length >= 40);
      return meaningfulSegments.some(segment => requestText.includes(segment));
    }

    function stripLoreDirectives(text) {
      return String(text || '').replace(/\{\{[^{}]+::[^{}]*\}\}/g, '');
    }

    function formatSettingBlocks(parts) {
      const loreText = parts.activeLorebooks.length
        ? parts.activeLorebooks
            .map((lore, idx) => `[로어북 ${idx + 1}: ${lore.label}]\n${lore.content}`)
            .join('\n\n')
        : '(활성 로어북 매칭 없음)';

      return [
        '[캐릭터 설명]',
        parts.characterDescription,
        '',
        '[유저 설명]',
        parts.userDescription,
        '',
        '[작가의 노트]',
        parts.authorNote,
        '',
        '[현재 활성화된 로어북]',
        loreText,
      ].join('\n');
    }

    function findLastIndex(arr, predicate) {
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (predicate(arr[i])) return i;
      }
      return -1;
    }

    // ── 동적 파이프라인 ───────────────────────────────────────────────────────

    const DEFAULT_OUTPUT_PRE =
      '간결한 불릿 포인트 메모만 작성하세요. 최종 RP 응답은 작성하지 마세요.';
    const DEFAULT_OUTPUT_POST =
      '메인 모델 응답을 수정한 최종 사용자 응답만 출력하세요. 분석 메모, 설명, 변경 목록, 접두사는 출력하지 마세요.';

    const DEFAULT_AGENT_PRESETS = [
      {
        id: 'agent-world',
        row: 0,
        column: 0,
        name: '세계관 에이전트',
        systemPrompt:
          '당신은 세계관 일관성 에이전트입니다.\n' +
          '주어진 설정과 대화 히스토리를 바탕으로 현재 씬의 세계관 주의사항과 보강 정보를 작성하세요.\n\n' +
          '포함할 항목:\n' +
          '- 현재 씬/배경 정보\n' +
          '- 활성화된 세계관 규칙\n' +
          '- 주의해야 할 기확립 설정\n' +
          '- 세계관 보강 정보',
      },
      {
        id: 'agent-plot',
        row: 1,
        column: 0,
        name: '플롯 에이전트',
        systemPrompt:
          '당신은 플롯 관리 에이전트입니다.\n' +
          '설정, 이전 에이전트 메모, 대화 히스토리를 바탕으로 현재 서사 흐름을 분석하고 이번 씬의 플롯 방향을 제시하세요.\n\n' +
          '포함할 항목:\n' +
          '- 현재 아크/스토리 진행 상황\n' +
          '- 이번 씬 목적\n' +
          '- 권장 전개 방향\n' +
          '- 유지해야 할 복선/미공개 정보',
      },
      {
        id: 'agent-character',
        row: 2,
        column: 0,
        name: '캐릭터 에이전트',
        systemPrompt:
          '당신은 등장인물 에이전트입니다.\n' +
          '설정과 이전 에이전트 메모를 바탕으로 이번 씬 캐릭터들의 성격과 말투를 정리하세요.\n\n' +
          '포함할 항목:\n' +
          '- 주요 캐릭터 성격/말투 특성\n' +
          '- 현재 캐릭터 심리 상태\n' +
          '- OOC(Out of Character) 주의사항\n' +
          '- 등장 예정 캐릭터 안내',
      },
    ];

    function createEmptyPipeline() {
      return {
        version: 1,
        rows: Array.from({ length: PIPELINE_ROW_COUNT }, (_, row) => ({
          row,
          label: row === MAIN_ROW_INDEX ? 'Main Model' : `Row ${row + 1}`,
          agents: [],
        })),
      };
    }

    function defaultPipelineConfig() {
      const pipeline = createEmptyPipeline();
      DEFAULT_AGENT_PRESETS.forEach((preset) => {
        pipeline.rows[preset.row].agents.push(normalizeAgent(preset, preset.row, preset.column, null));
      });
      return normalizePipelineConfig(pipeline);
    }

    function normalizePipelineConfig(raw, modelPresets = null, legacy = null) {
      const fallback = createEmptyPipeline();
      const sourceRows = Array.isArray(raw?.rows) ? raw.rows : Array.isArray(raw) ? raw : [];

      for (let row = 0; row < PIPELINE_ROW_COUNT; row += 1) {
        const sourceRow = sourceRows.find(r => Number(r?.row) === row) || sourceRows[row] || {};
        const agents = Array.isArray(sourceRow?.agents) ? sourceRow.agents : [];
        const normalized = agents
          .map((agent, idx) => normalizeAgent(agent, row, idx, modelPresets, legacy))
          .filter(agent => agent.row !== MAIN_ROW_INDEX)
          .sort((a, b) => a.column - b.column);

        fallback.rows[row].agents = row > MAIN_ROW_INDEX ? normalized.slice(0, 1) : normalized;
        fallback.rows[row].agents.forEach((agent, idx) => {
          agent.column = idx;
        });
      }

      return fallback;
    }

    async function getPipelineConfig(conf) {
      const raw = await Risuai.getArgument('agent_pipeline_json');
      if (!raw) return normalizePipelineConfig(defaultPipelineConfig(), conf?.modelPresets, conf);

      try {
        return normalizePipelineConfig(JSON.parse(String(raw)), conf?.modelPresets, conf);
      } catch (err) {
        if (conf?.debugLog) console.log(`MultiAgent pipeline JSON parse failed: ${err.message}`);
        return defaultPipelineConfig();
      }
    }

    function normalizeAgent(agent, row, column, modelPresets = null, legacy = null) {
      const mode = row < MAIN_ROW_INDEX ? 'pre' : 'post';
      const modelPresetId = resolveAgentPresetId(agent, modelPresets, legacy);
      return {
        id: String(agent?.id || makeAgentId(mode)),
        name: String(agent?.name || (mode === 'pre' ? '새 노트 에이전트' : '새 후처리 에이전트')),
        enabled: agent?.enabled !== false,
        mode,
        row,
        column: Number.isFinite(Number(agent?.column)) ? Number(agent.column) : column,
        systemPrompt: String(agent?.systemPrompt || defaultSystemPromptForMode(mode)),
        outputInstruction: String(agent?.outputInstruction || (mode === 'pre' ? DEFAULT_OUTPUT_PRE : DEFAULT_OUTPUT_POST)),
        modelPresetId,
        includeSettingBlocks: agent?.includeSettingBlocks !== undefined
          ? agent.includeSettingBlocks !== false
          : agent?.includeCuratedContext !== false,
        includeHistory: agent?.includeHistory !== false,
        includeUserInput: agent?.includeUserInput !== false,
        includePreviousNotes: agent?.includePreviousNotes !== false,
        memoryEnabled: mode === 'pre' && agent?.memoryEnabled === true,
        memoryInstruction: String(agent?.memoryInstruction || ''),
        memoryFormat: String(agent?.memoryFormat || ''),
      };
    }

    function resolveAgentPresetId(agent, modelPresets, legacy) {
      const presets = Array.isArray(modelPresets) ? modelPresets : [];
      if (agent?.modelPresetId && presets.some(preset => preset.id === agent.modelPresetId)) {
        return String(agent.modelPresetId);
      }
      if (agent?.modelPresetId && presets.length === 0) {
        return String(agent.modelPresetId);
      }
      if (hasLegacyAgentModelOverride(agent) && presets.length > 0) {
        return findOrCreateLegacyAgentPreset(agent, presets, legacy).id;
      }
      return presets[0]?.id || DEFAULT_MODEL_PRESET_ID;
    }

    function hasLegacyAgentModelOverride(agent) {
      return Boolean(agent?.provider || agent?.baseUrl || agent?.model || agent?.temperature || agent?.maxTokens || agent?.contextWindow);
    }

    function findOrCreateLegacyAgentPreset(agent, presets, legacy) {
      const candidate = {
        id: `preset-migrated-${String(agent.id || makeAgentId('agent')).replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        name: `${String(agent.name || 'Migrated Agent')} Model`,
        provider: normalizeProviderValue(agent.provider || legacy?.provider || DEFAULT_AGENT_PROVIDER),
        baseUrl: normalizeUrl(agent.baseUrl || legacy?.baseUrl || DEFAULT_AGENT_BASE_URL),
        model: String(agent.model || legacy?.model || DEFAULT_AGENT_MODEL),
        temperature: agent.temperature === null || agent.temperature === undefined || agent.temperature === ''
          ? String(legacy?.temperature ?? 0.7)
          : String(agent.temperature),
        maxTokens: agent.maxTokens === null || agent.maxTokens === undefined ? '' : String(agent.maxTokens),
        contextWindow: agent.contextWindow === null || agent.contextWindow === undefined || agent.contextWindow === ''
          ? String(legacy?.window || 10)
          : String(agent.contextWindow),
      };
      const existing = presets.find(preset =>
        preset.provider === candidate.provider &&
        normalizeUrl(preset.baseUrl) === candidate.baseUrl &&
        preset.model === candidate.model &&
        String(preset.temperature) === candidate.temperature &&
        String(preset.maxTokens || '') === candidate.maxTokens &&
        String(preset.contextWindow || '') === candidate.contextWindow
      );
      if (existing) return existing;
      presets.push(candidate);
      return candidate;
    }

    function defaultSystemPromptForMode(mode) {
      if (mode === 'post') {
        return '당신은 RP 응답 후처리 에이전트입니다. 현재 응답을 설정, 사전 에이전트 노트, 문맥에 맞게 자연스럽게 수정하세요.';
      }
      return '당신은 RP 보조 분석 에이전트입니다. 현재 요청에 도움이 되는 간결한 메모를 작성하세요.';
    }

    function makeAgentId(prefix) {
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function resolveAgentConfig(agent, conf) {
      const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
      const temperature = parseAgentFloat(preset.temperature, conf.temperature);
      const maxTokens = parseAgentOptionalInt(preset.maxTokens, conf.maxTokens);
      const window = Math.max(1, parseInt(preset.contextWindow || conf.window, 10) || conf.window || 10);
      const provider = preset.provider || conf.provider;
      return {
        ...conf,
        provider,
        baseUrl: normalizeUrl(preset.baseUrl || conf.baseUrl),
        apiKey: getProviderApiKey(conf.providerKeys, provider),
        model: preset.model || conf.model,
        temperature,
        maxTokens,
        window,
      };
    }

    function parseAgentFloat(value, fallback) {
      if (value === '' || value === null || value === undefined) return fallback;
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function parseAgentOptionalInt(value, fallback) {
      if (value === '' || value === null || value === undefined) return fallback;
      return parseOptionalInt(value);
    }

    function getEnabledAgentsForRow(pipeline, row) {
      return (pipeline.rows[row]?.agents || [])
        .filter(agent => agent.enabled !== false)
        .sort((a, b) => a.column - b.column);
    }

    function hasUsableProviderKeyForRows(pipeline, conf, startRow, endRow) {
      const agents = [];
      for (let row = startRow; row <= endRow; row += 1) {
        agents.push(...getEnabledAgentsForRow(pipeline, row));
      }
      if (agents.length === 0) return true;
      return agents.some(agent => {
        const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
        return Boolean(getProviderApiKey(conf.providerKeys, preset.provider));
      });
    }

    function buildAgentPrompt(agent, context) {
      const sections = [];

      if (agent.includeSettingBlocks) {
        sections.push(context.settingBlocks || formatSettingBlocks({
          characterDescription: '(캐릭터 설명 없음)',
          userDescription: '(유저 설명 없음)',
          authorNote: '(작가의 노트 없음)',
          activeLorebooks: [],
        }));
      }
      if (agent.mode === 'pre' && agent.includeHistory) {
        sections.push(`[최근 대화]\n${context.history || '(최근 대화 없음)'}`);
      }
      if (agent.mode === 'pre' && agent.includeUserInput) {
        sections.push(`[현재 유저 입력]\n${context.userInput || '(현재 유저 입력 없음)'}`);
      }
      if (agent.includePreviousNotes) {
        const label = agent.mode === 'post' ? 'Pre-Agent 노트' : '이전 에이전트 노트';
        sections.push(`[${label}]\n${formatAgentNotes(context.notes, '(이전 에이전트 노트 없음)')}`);
      }
      if (agent.mode === 'pre' && agent.memoryEnabled) {
        sections.push(`[이전 기억]\n${context.agentMemory || EMPTY_AGENT_MEMORY}`);
        sections.push(`[기억 지시]\n${agent.memoryInstruction || '(기억 지시 없음)'}`);
        sections.push(`[기억 포맷]\n${agent.memoryFormat || '(지정된 기억 포맷 없음)'}`);
      }
      if (agent.mode === 'post') {
        sections.push(`[현재 응답]\n${context.currentResponse || ''}`);
      }

      sections.push(`[${agent.mode === 'post' ? '후처리 지시' : '현재 에이전트 지시'}]\n${agent.outputInstruction}`);

      const systemContent = [
        agent.systemPrompt,
        '',
        agent.mode === 'post'
          ? '반드시 최종 사용자에게 보여줄 수정 응답만 출력하세요. 분석 메모, 설명, 변경 목록을 출력하지 마세요.'
          : '최종 RP 응답은 작성하지 말고 보조 메모만 작성하세요.',
        agent.mode === 'pre' && agent.memoryEnabled ? `\n${memoryOutputContract(agent)}` : '',
      ].join('\n');

      return [
        { role: 'system', content: systemContent },
        { role: 'user', content: sections.join('\n\n') },
      ];
    }

    function formatAgentNotes(notes, emptyText) {
      const active = (notes || []).filter(note => note && note.content !== undefined);
      if (active.length === 0) return emptyText;
      return active
        .slice()
        .sort((a, b) => (a.row - b.row) || (a.column - b.column))
        .map(note => `[Row ${note.row + 1} / ${note.name}]\n${note.content}`)
        .join('\n\n');
    }

    function memoryOutputContract(agent = null) {
      const lines = [
        '이 에이전트는 기억 갱신이 활성화되어 있습니다.',
        '반드시 아래 형식을 정확히 지켜 출력하세요. 태그 밖에는 아무 텍스트도 쓰지 마세요.',
        'MEMORY_UPDATE는 저장 전용이며, 다음 턴에 유지할 최신 기억 전체 상태여야 합니다.',
        'MEMORY_UPDATE에는 AGENT_NOTE의 보조 분석이나 최종 RP 응답을 섞지 마세요.',
        '',
        `[${MEMORY_NOTE_TAG}]`,
        '다음 에이전트나 메인 모델에게 전달할 보조 노트',
        `[/${MEMORY_NOTE_TAG}]`,
        '',
        `[${MEMORY_UPDATE_TAG}]`,
        '다음 턴에 유지할 최신 기억 전체. 변경분만 쓰지 말고 전체 상태를 작성하세요.',
        `[/${MEMORY_UPDATE_TAG}]`,
      ];

      if (agent?.memoryFormat) {
        lines.push(
          '',
          '중요: MEMORY_UPDATE는 반드시 [기억 포맷]에 적힌 형태만 따르세요.',
          '설명, 요약, 배경 정보, 마크다운, 불릿 포인트, 제목을 추가하지 마세요.',
        );
      }

      return lines.join('\n');
    }

    function parseTaggedBlock(text, tag) {
      const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = String(text || '').match(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)\\[\\/${escaped}\\]`, 'i'));
      return match ? match[1].trim() : null;
    }

    function parseMemoryAgentOutput(text) {
      const note = parseTaggedBlock(text, MEMORY_NOTE_TAG);
      const memoryUpdate = parseTaggedBlock(text, MEMORY_UPDATE_TAG);
      return {
        ok: note !== null && memoryUpdate !== null,
        note: note || '',
        memoryUpdate: memoryUpdate || '',
      };
    }

    function hasMemoryEnabledPreAgents(pipeline) {
      for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
        if (getEnabledAgentsForRow(pipeline, row).some(agent => agent.memoryEnabled)) return true;
      }
      return false;
    }

    async function getAgentMemoryScope(debugLog) {
      let character = null;
      try {
        character = await Risuai.getCharacter();
      } catch (err) {
        if (debugLog) console.log(`Agents! memory: getCharacter failed: ${err.message}`);
      }

      let chatIndex = null;
      try {
        chatIndex = await Risuai.getCurrentChatIndex();
      } catch (err) {
        if (debugLog) console.log(`Agents! memory: getCurrentChatIndex failed: ${err.message}`);
      }

      if (!Number.isFinite(Number(chatIndex))) {
        chatIndex = Number.isInteger(character?.chatPage) ? character.chatPage : 0;
      }

      const normalizedChatIndex = Math.max(0, parseInt(chatIndex, 10) || 0);
      const chats = Array.isArray(character?.chats) ? character.chats : [];
      const chat = chats[normalizedChatIndex] || getCurrentCharacterChat(character);
      const characterId = firstNonEmpty(character?.chaId, character?.id, character?.name, 'unknown-character');
      const characterName = firstNonEmpty(character?.name, '(알 수 없는 캐릭터)');
      const chatName = firstNonEmpty(chat?.name, chat?.title, chat?.chatName, `Chat ${normalizedChatIndex + 1}`);
      return {
        characterId: sanitizeMemoryKeyPart(characterId),
        chatIndex: String(normalizedChatIndex),
        characterName,
        chatName,
      };
    }

    function sanitizeMemoryKeyPart(value) {
      return encodeURIComponent(String(value || 'unknown'));
    }

    function agentMemoryKey(agent, scope) {
      return `agents_memory:${scope?.characterId || 'unknown-character'}:${scope?.chatIndex || '0'}:${sanitizeMemoryKeyPart(agent.id)}`;
    }

    function agentRunLogKey(scope) {
      return `agents_run:${scope?.characterId || 'unknown-character'}:${scope?.chatIndex || '0'}`;
    }

    async function loadAgentMemory(agent, scope, debugLog) {
      if (!agent.memoryEnabled || agent.mode !== 'pre') {
        return { enabled: false, value: '', key: '' };
      }

      const key = agentMemoryKey(agent, scope || {});
      try {
        const raw = await Risuai.pluginStorage.getItem(key);
        const value = typeof raw === 'object' && raw !== null
          ? String(raw.value || '').trim()
          : String(raw || '').trim();
        if (debugLog) console.log(`Agents! memory loaded (${agent.name}): ${value ? 'found' : 'empty'} ${key}`);
        return {
          enabled: true,
          key,
          value,
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
        };
      } catch (err) {
        if (debugLog) console.log(`Agents! memory load failed (${agent.name}): ${err.message}`);
        return {
          enabled: true,
          key,
          value: '',
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
          failed: true,
        };
      }
    }

    async function saveAgentMemory(agent, memory, memoryUpdate, debugLog) {
      if (!memory?.enabled || !memory.key) return false;
      const nextMemory = String(memoryUpdate || '').trim();
      if (!nextMemory) {
        if (debugLog) console.log(`Agents! memory update empty (${agent.name}); keeping previous memory`);
        return false;
      }

      try {
        await Risuai.pluginStorage.setItem(memory.key, {
          value: nextMemory,
          updatedAt: Date.now(),
          agentId: agent.id,
          agentName: agent.name,
          characterId: memory.characterId,
          chatIndex: memory.chatIndex,
        });
        if (debugLog) console.log(`Agents! memory saved (${agent.name}): ${memory.key}`);
        return true;
      } catch (err) {
        if (debugLog) console.log(`Agents! memory save failed (${agent.name}): ${err.message}`);
        return false;
      }
    }

    function runAgentMeta(agent, conf) {
      const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
      return {
        id: agent.id,
        name: agent.name,
        row: agent.row,
        column: agent.column,
        mode: agent.mode,
        enabled: agent.enabled !== false,
        modelPresetId: agent.modelPresetId,
        modelPresetName: preset?.name || '',
        model: preset?.model || '',
        provider: preset?.provider || '',
        memoryEnabled: agent.mode === 'pre' && agent.memoryEnabled === true,
        memoryInstruction: agent.mode === 'pre' ? agent.memoryInstruction || '' : '',
        memoryFormat: agent.mode === 'pre' ? agent.memoryFormat || '' : '',
      };
    }

    function createRunLogBase(type, pipeline, conf, scope, status = 'running', reason = '') {
      return {
        version: RUN_LOG_VERSION,
        type,
        status,
        reason,
        characterId: scope?.characterId || 'unknown-character',
        chatIndex: scope?.chatIndex || '0',
        characterName: scope?.characterName || '(알 수 없는 캐릭터)',
        chatName: scope?.chatName || `(알 수 없는 채팅방)`,
        runKey: agentRunLogKey(scope || {}),
        pipelineSnapshot: JSON.parse(JSON.stringify(pipeline || createEmptyPipeline())),
        preResults: [],
        postResults: [],
        notes: [],
        userInput: '',
        settingBlocks: '',
        settingBlockStats: null,
        timestamp: Date.now(),
        updatedAt: Date.now(),
      };
    }

    async function persistRunLog(run, debugLog) {
      if (!run?.runKey) return false;
      try {
        run.updatedAt = Date.now();
        await Risuai.pluginStorage.setItem(run.runKey, run);
        if (debugLog) console.log(`Agents! run log saved: ${run.runKey}`);
        return true;
      } catch (err) {
        if (debugLog) console.log(`Agents! run log save failed: ${err.message}`);
        return false;
      }
    }

    async function loadCurrentRunLog(debugLog) {
      const scope = await getAgentMemoryScope(debugLog);
      const key = agentRunLogKey(scope);
      try {
        const run = await Risuai.pluginStorage.getItem(key);
        if (run && typeof run === 'object') {
          return {
            ...run,
            characterName: run.characterName || scope.characterName,
            chatName: run.chatName || scope.chatName,
          };
        }
        return {
          version: RUN_LOG_VERSION,
          status: 'no-run',
          reason: '',
          characterId: scope.characterId,
          chatIndex: scope.chatIndex,
          characterName: scope.characterName,
          chatName: scope.chatName,
          runKey: key,
          preResults: [],
          postResults: [],
          notes: [],
        };
      } catch (err) {
        if (debugLog) console.log(`Agents! run log load failed: ${err.message}`);
        return {
          version: RUN_LOG_VERSION,
          status: 'load-failed',
          reason: err.message,
          characterId: scope.characterId,
          chatIndex: scope.chatIndex,
          characterName: scope.characterName,
          chatName: scope.chatName,
          runKey: key,
          preResults: [],
          postResults: [],
          notes: [],
        };
      }
    }

    async function runPrePipeline(messages, conf, pipeline, settingBlocks, type, runScope) {
      const notes = [];
      const userInput = getUserInput(messages);
      const memoryScope = hasMemoryEnabledPreAgents(pipeline)
        ? runScope || await getAgentMemoryScope(conf.debugLog)
        : null;
      const preResults = [];

      for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
        const agents = getEnabledAgentsForRow(pipeline, row);
        if (agents.length === 0) continue;

        const rowResults = await Promise.all(agents.map(async (agent) => {
          const agentConf = resolveAgentConfig(agent, conf);
          if (!agentConf.apiKey) {
            const content = `(실패: ${agentConf.provider} provider API key 없음)`;
            console.log(`MultiAgent pre-agent skipped (${agent.name}): ${agentConf.provider} provider API key not set`);
            return {
              ...runAgentMeta(agent, conf),
              content,
              rawOutput: content,
              status: 'skipped',
              failed: true,
              memoryStatus: agent.memoryEnabled ? 'skipped' : 'disabled',
            };
          }
          const history = formatHistory(messages, agentConf.window);
          const agentMemory = await loadAgentMemory(agent, memoryScope, conf.debugLog);
          const prompt = buildAgentPrompt(agent, {
            settingBlocks: settingBlocks.content,
            history,
            userInput,
            notes,
            agentMemory: agentMemory.value || EMPTY_AGENT_MEMORY,
          });

          if (conf.debugLog) logPromptFlow(`MultiAgent debug: Row ${row + 1} ${agent.name} prompt`, prompt, true);

          try {
            const content = await callAgent(agentConf, prompt);
            if (conf.debugLog) logTextBlock(`MultiAgent debug: Row ${row + 1} ${agent.name} result`, content);
            if (agentMemory.enabled) {
              const parsed = parseMemoryAgentOutput(content);
              if (parsed.ok) {
                const saved = await saveAgentMemory(agent, agentMemory, parsed.memoryUpdate, conf.debugLog);
                const memoryStatus = parsed.memoryUpdate
                  ? saved ? 'updated' : 'storage-failed'
                  : 'empty-update';
                return {
                  ...runAgentMeta(agent, conf),
                  content: parsed.note || content,
                  rawOutput: content,
                  status: 'success',
                  memoryPrevious: agentMemory.value || '',
                  memoryUpdate: parsed.memoryUpdate,
                  memoryStatus,
                  memoryUpdated: Boolean(parsed.memoryUpdate && saved),
                };
              }
              if (conf.debugLog) console.log(`Agents! memory parse failed (${agent.name}); keeping previous memory`);
              return {
                ...runAgentMeta(agent, conf),
                content,
                rawOutput: content,
                status: 'success',
                memoryPrevious: agentMemory.value || '',
                memoryUpdate: '',
                memoryStatus: 'parse-failed',
                memoryUpdated: false,
              };
            }
            return {
              ...runAgentMeta(agent, conf),
              content,
              rawOutput: content,
              status: 'success',
              memoryStatus: 'disabled',
            };
          } catch (err) {
            const content = `(실패: ${err.message})`;
            console.log(`MultiAgent pre-agent failed (${agent.name}): ${err.message}`);
            return {
              ...runAgentMeta(agent, conf),
              content,
              rawOutput: content,
              status: 'failed',
              failed: true,
              error: err.message,
              memoryStatus: agent.memoryEnabled ? 'failed' : 'disabled',
            };
          }
        }));

        const sortedResults = rowResults.sort((a, b) => a.column - b.column);
        notes.push(...sortedResults.map(result => ({
          id: result.id,
          name: result.name,
          row: result.row,
          column: result.column,
          content: result.content,
          failed: result.failed,
        })));
        preResults.push(...sortedResults);
      }

      lastPipelineRun = {
        version: RUN_LOG_VERSION,
        type,
        status: 'pre-complete',
        reason: '',
        characterId: runScope?.characterId || 'unknown-character',
        chatIndex: runScope?.chatIndex || '0',
        characterName: runScope?.characterName || '(알 수 없는 캐릭터)',
        chatName: runScope?.chatName || '(알 수 없는 채팅방)',
        runKey: agentRunLogKey(runScope || {}),
        pipelineSnapshot: JSON.parse(JSON.stringify(pipeline)),
        settingBlocks: settingBlocks.content,
        settingBlockStats: settingBlocks.stats,
        preResults,
        postResults: [],
        notes,
        userInput,
        timestamp: Date.now(),
        updatedAt: Date.now(),
      };

      return notes;
    }

    async function runPostPipeline(content, conf, pipeline, type) {
      let currentResponse = String(content ?? '');
      const previousRun = lastPipelineRun || {
        type,
        postResults: [],
        settingBlocks: formatSettingBlocks({
          characterDescription: '(캐릭터 설명 없음)',
          userDescription: '(유저 설명 없음)',
          authorNote: '(작가의 노트 없음)',
          activeLorebooks: [],
        }),
        notes: [],
      };
      const postResults = Array.isArray(previousRun.postResults) ? previousRun.postResults : [];

      for (let row = MAIN_ROW_INDEX + 1; row < PIPELINE_ROW_COUNT; row += 1) {
        const agent = getEnabledAgentsForRow(pipeline, row)[0];
        if (!agent) continue;

        const agentConf = resolveAgentConfig(agent, conf);
        if (!agentConf.apiKey) {
          console.log(`MultiAgent post-agent skipped (${agent.name}): ${agentConf.provider} provider API key not set`);
          postResults.push({
            ...runAgentMeta(agent, conf),
            status: 'skipped',
            failed: true,
            inputResponse: currentResponse,
            outputResponse: currentResponse,
            error: `${agentConf.provider} provider API key 없음`,
          });
          continue;
        }
        const prompt = buildAgentPrompt(agent, {
          settingBlocks: previousRun.settingBlocks,
          notes: previousRun.notes,
          currentResponse,
        });

        if (conf.debugLog) logPromptFlow(`MultiAgent debug: Row ${row + 1} ${agent.name} post-agent prompt`, prompt, true);

        try {
          const nextResponse = String(await callAgent(agentConf, prompt) || '').trim();
          if (nextResponse) {
            postResults.push({
              ...runAgentMeta(agent, conf),
              status: 'success',
              inputResponse: currentResponse,
              outputResponse: nextResponse,
              rawOutput: nextResponse,
            });
            currentResponse = nextResponse;
            if (conf.debugLog) logTextBlock(`MultiAgent debug: Row ${row + 1} ${agent.name} post-agent result`, currentResponse);
          } else {
            console.log(`MultiAgent post-agent returned empty response (${agent.name}); keeping previous response`);
            postResults.push({
              ...runAgentMeta(agent, conf),
              status: 'empty',
              inputResponse: currentResponse,
              outputResponse: currentResponse,
              rawOutput: '',
            });
          }
        } catch (err) {
          console.log(`MultiAgent post-agent failed (${agent.name}): ${err.message}`);
          postResults.push({
            ...runAgentMeta(agent, conf),
            status: 'failed',
            failed: true,
            inputResponse: currentResponse,
            outputResponse: currentResponse,
            error: err.message,
          });
        }
      }

      if (lastPipelineRun) {
        lastPipelineRun.postResults = postResults;
        lastPipelineRun.status = 'complete';
        lastPipelineRun.finalResponse = currentResponse;
      }

      return currentResponse;
    }

    // ── 컨텍스트 주입 ─────────────────────────────────────────────────────────

    function injectAgentNotes(messages, orderedNotes) {
      if (!orderedNotes || orderedNotes.length === 0) return messages;

      const injection = [
        '',
        '---',
        '[MultiAgent RP 분석 컨텍스트]',
        '',
        formatAgentNotes(orderedNotes, '(에이전트 노트 없음)'),
        '',
        '[검수 지침]',
        '위 분석을 참고하여 세계관 위반, 플롯 역행, OOC 오류를 감지하고 수정한 뒤 최종 RP 응답을 작성하세요.',
        '---',
      ].join('\n');

      const lastSystemIdx = findLastIndex(messages, m => m.role === 'system');
      if (lastSystemIdx >= 0) {
        return messages.map((m, idx) =>
          idx === lastSystemIdx ? { ...m, content: m.content + injection } : m
        );
      }
      return [{ role: 'system', content: injection.replace(/^\n/, '') }, ...messages];
    }

    // ── 설정 GUI ──────────────────────────────────────────────────────────────

    async function openLiteDashboard() {
      console.log('Agents! opening full settings dashboard');
      const conf = await getConfig();
      const pipeline = await getPipelineConfig(conf);
      document.body.innerHTML = buildLiteUI(conf, pipeline);
      setupLiteHandlers(conf, pipeline);
      await Risuai.showContainer('fullscreen');
    }

    async function openRunInspector() {
      console.log('Agents! opening run inspector');
      const conf = await getConfig();
      const pipeline = await getPipelineConfig(conf);
      const runLog = await loadCurrentRunLog(conf.debugLog);
      document.body.innerHTML = buildRunInspectorUI(pipeline, runLog);
      setupRunInspectorHandlers(conf, pipeline, runLog);
      await Risuai.showContainer('fullscreen');
    }

    const menuIcon = '';

    await registerLiteUIEntrypoints();

    async function registerLiteUIEntrypoints() {
      await unregisterKnownUIPart(SETTINGS_UI_ID);
      await unregisterKnownUIPart(HAMBURGER_UI_ID);
      await unregisterKnownUIPart(CHAT_UI_ID);

      try {
        const setting = await Risuai.registerSetting('Agents! 설정', openLiteDashboard, menuIcon, 'none', SETTINGS_UI_ID);
        console.log('Agents! setting registered', setting?.id || setting || '');
      } catch (err) {
        console.log(`MultiAgent Lite setting registration failed: ${err.message}`);
      }

      try {
        const button = await Risuai.registerButton({
          name: 'Agents! Run Inspector',
          icon: menuIcon,
          iconType: 'none',
          location: 'hamburger',
          id: HAMBURGER_UI_ID,
        }, openRunInspector);
        console.log('Agents! hamburger button registered', button?.id || button || '');
      } catch (err) {
        console.log(`MultiAgent Lite hamburger button registration failed: ${err.message}`);
      }

      try {
        const chatButton = await Risuai.registerButton({
          name: 'Agents! 설정',
          icon: menuIcon,
          iconType: 'none',
          location: 'chat',
          id: CHAT_UI_ID,
        }, openLiteDashboard);
        console.log('Agents! chat menu button registered', chatButton?.id || chatButton || '');
      } catch (err) {
        console.log(`MultiAgent Lite chat menu button registration failed: ${err.message}`);
      }
    }

    async function unregisterKnownUIPart(id) {
      try {
        await Risuai.unregisterUIPart(id);
      } catch (_) {
        // 없는 항목이면 무시합니다.
      }
    }

    function buildRunInspectorUI(pipeline, runLog) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101114;color:#eceff4;min-height:100vh;line-height:1.45}
.wrap{max-width:1120px;margin:0 auto;padding:22px 16px 84px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
h1{font-size:1.34rem;font-weight:720;letter-spacing:0;margin-bottom:4px}.subtitle{color:#98a2b3;font-size:.84rem}
.header-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.run-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.run-meta .badge{font-size:.74rem}
.card{background:#191b20;border:1px solid #292d35;border-radius:8px;padding:14px;margin-bottom:12px}.card h2{font-size:.91rem;margin-bottom:10px;color:#f2f4f7}
.inspector-shell{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(330px,.75fr);gap:12px;align-items:start}
.pipeline-rows{display:grid;gap:8px}.pipeline-row{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;align-items:center;background:#111318;border:1px solid #272c34;border-radius:8px;padding:9px}
.pipeline-row.main{border-color:#4b5565;background:#171a20}.row-label{font-size:.77rem;color:#aab3c1;font-weight:720}.row-kind{font-size:.68rem;color:#7d8795;margin-top:2px}
.agent-lane{display:flex;gap:8px;flex-wrap:wrap;min-height:38px;align-items:center}.agent-card{border:1px solid #373d48;background:#1b1f26;border-radius:7px;padding:8px 10px;min-width:150px;max-width:230px;cursor:pointer}
.agent-card:hover,.agent-card.selected{border-color:#5e91ee;background:#202838}.agent-card.disabled{opacity:.54}.agent-card.missing{border-style:dashed}.agent-card.success{border-color:#2f7651}.agent-card.failed,.agent-card.skipped{border-color:#7a3b3b}
.agent-name{font-size:.82rem;font-weight:720;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agent-meta{font-size:.69rem;color:#9ba6b5;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.main-chip{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border:1px solid #596171;background:#20242d;border-radius:7px;padding:8px 12px;font-size:.84rem;font-weight:760}
.metric-sub{font-size:.74rem;color:#a8b0bd;margin-top:2px;overflow-wrap:anywhere}.badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:.72rem;font-weight:680}
.badge.ok{background:#123323;color:#6ee7a8}.badge.err{background:#3a1717;color:#ff8a8a}.badge.neutral{background:#27313c;color:#a8c7e6}
.detail-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.detail-block{background:#0f1115;border:1px solid #303640;border-radius:7px;padding:10px;margin-top:10px}
.detail-block h3{font-size:.78rem;color:#cbd5e1;margin-bottom:7px}.detail-block pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;color:#eef2f7}
.empty{color:#9aa4b2;font-size:.84rem;padding:12px;border:1px dashed #363d47;border-radius:8px}.actions{position:fixed;left:0;right:0;bottom:0;background:rgba(16,17,20,.96);border-top:1px solid #2a2e36;padding:10px 16px}
.actions-inner{max-width:1120px;margin:0 auto;display:flex;gap:8px;justify-content:flex-end}button{padding:9px 14px;border-radius:7px;border:1px solid #343944;background:#20242b;color:#eef2f7;cursor:pointer;font-size:.86rem;font-weight:650}
button:hover{background:#2a3039}button.ghost{background:#15171b;color:#a8b0bd}
button.primary{background:#2f6fed;border-color:#2f6fed;color:#fff}button.primary:hover{background:#275fce}
@media (max-width: 860px){.top{display:block}.inspector-shell{grid-template-columns:1fr}.pipeline-row{grid-template-columns:72px minmax(0,1fr)}}
</style></head><body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>Agents! Run Inspector</h1>
      <p class="subtitle">${escHtml(runSummaryText(runLog))}</p>
      <div class="run-meta">
        <span class="badge neutral">캐릭터: ${escHtml(runLog?.characterName || '(알 수 없는 캐릭터)')}</span>
        <span class="badge neutral">채팅방: ${escHtml(runLog?.chatName || '(알 수 없는 채팅방)')}</span>
      </div>
    </div>
    <div class="header-actions">
      <button id="run-inspector-tab-btn" class="primary">Run Inspector</button>
      <button id="settings-tab-btn" class="ghost">설정</button>
    </div>
  </div>
  <div class="card">
    <h2>최근 실행 결과</h2>
    <div class="inspector-shell">
      <div id="inspector-rows" class="pipeline-rows"></div>
      <div id="inspector-detail" class="card" style="margin-bottom:0"></div>
    </div>
  </div>
</div>
<div class="actions"><div class="actions-inner"><button id="close-btn" class="ghost">닫기</button></div></div>
</body></html>`;
    }

    function setupRunInspectorHandlers(conf, pipeline, runLog) {
      let selectedAgentId = findDefaultInspectorAgentId(pipeline, runLog);
      renderInspectorRows();
      renderInspectorDetail();

      document.getElementById('close-btn')?.addEventListener('click', async () => {
        await Risuai.hideContainer();
      });
      document.getElementById('settings-tab-btn')?.addEventListener('click', openLiteDashboard);

      function renderInspectorRows() {
        const root = document.getElementById('inspector-rows');
        if (!root) return;
        root.innerHTML = pipeline.rows.map((row) => {
          if (row.row === MAIN_ROW_INDEX) {
            return `<div class="pipeline-row main">
              <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">Fixed</div></div>
              <div class="agent-lane"><span class="main-chip">Main Model</span></div>
            </div>`;
          }

          const mode = row.row < MAIN_ROW_INDEX ? 'Pre' : 'Post';
          const cards = (row.agents || []).map(agent => inspectorAgentCardHtml(agent)).join('');
          return `<div class="pipeline-row">
            <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">${mode}</div></div>
            <div class="agent-lane">${cards || '<span class="metric-sub">비어 있음</span>'}</div>
          </div>`;
        }).join('');

        root.querySelectorAll('[data-agent-id]').forEach((card) => {
          card.addEventListener('click', () => {
            selectedAgentId = card.getAttribute('data-agent-id');
            renderInspectorRows();
            renderInspectorDetail();
          });
        });
      }

      function inspectorAgentCardHtml(agent) {
        const result = findRunResultForAgent(runLog, agent);
        const selected = agent.id === selectedAgentId ? ' selected' : '';
        const disabled = agent.enabled ? '' : ' disabled';
        const statusClass = result ? result.status || 'success' : 'missing';
        const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
        const memory = agent.mode === 'pre' && agent.memoryEnabled ? ' · 기억' : '';
        const status = result ? resultStatusLabel(result.status) : '결과 없음';
        return `<div class="agent-card${selected}${disabled} ${escHtml(statusClass)}" data-agent-id="${escHtml(agent.id)}">
          <div class="agent-name">${escHtml(agent.name)}</div>
          <div class="agent-meta">${escHtml(preset.name || preset.model || 'model preset')} · ${escHtml(status)}${escHtml(memory)}</div>
        </div>`;
      }

      function renderInspectorDetail() {
        const root = document.getElementById('inspector-detail');
        if (!root) return;
        const agent = findAgentById(pipeline, selectedAgentId);
        if (!agent) {
          root.innerHTML = '<h2>Agent Result</h2><div class="empty">에이전트를 선택하세요.</div>';
          return;
        }
        root.innerHTML = inspectorDetailHtml(agent, findRunResultForAgent(runLog, agent));
      }
    }

    function runSummaryText(runLog) {
      if (!runLog || runLog.status === 'no-run') return '아직 이 채팅에서 실행된 Agents! 결과가 없습니다.';
      if (runLog.status === 'load-failed') return `최근 실행 결과를 불러오지 못했습니다: ${runLog.reason || 'unknown error'}`;
      const time = runLog.updatedAt || runLog.timestamp;
      const date = time ? new Date(time).toLocaleString() : '시간 정보 없음';
      const status = runLog.reason ? `${runLog.status}: ${runLog.reason}` : runLog.status || 'saved';
      return `${date} · ${status}`;
    }

    function findDefaultInspectorAgentId(pipeline, runLog) {
      const resultIds = [
        ...(runLog?.preResults || []),
        ...(runLog?.postResults || []),
        ...(runLog?.notes || []),
      ].map(result => result.id).filter(Boolean);

      for (const id of resultIds) {
        if (findAgentById(pipeline, id)) return id;
      }
      return findFirstAgentId(pipeline);
    }

    function findRunResultForAgent(runLog, agent) {
      if (!runLog || !agent) return null;
      const source = agent.mode === 'post' ? runLog.postResults : runLog.preResults;
      const result = (source || []).find(item => item.id === agent.id || (item.row === agent.row && item.column === agent.column));
      if (result) return result;

      if (agent.mode === 'pre') {
        const note = (runLog.notes || []).find(item => item.id === agent.id || (item.row === agent.row && item.column === agent.column));
        if (note) {
          return {
            ...note,
            status: note.failed ? 'failed' : 'success',
            rawOutput: note.content,
            memoryStatus: 'disabled',
          };
        }
      }
      return null;
    }

    function resultStatusLabel(status) {
      const labels = {
        success: '성공',
        failed: '실패',
        skipped: '스킵',
        empty: '빈 응답',
      };
      return labels[status] || status || '성공';
    }

    function memoryStatusLabel(status) {
      const labels = {
        disabled: '비활성화',
        updated: '저장됨',
        'empty-update': '갱신 없음',
        'parse-failed': '파싱 실패',
        'storage-failed': '저장 실패',
        skipped: '스킵',
        failed: '실패',
      };
      return labels[status] || status || '알 수 없음';
    }

    function statusBadgeClass(status) {
      if (status === 'success' || status === 'updated') return 'ok';
      if (status === 'failed' || status === 'skipped' || status === 'parse-failed' || status === 'storage-failed') return 'err';
      return 'neutral';
    }

    function inspectorDetailHtml(agent, result) {
      const modeLabel = agent.mode === 'post' ? 'Post-Agent' : 'Pre-Agent';
      const resultBadge = result
        ? `<span class="badge ${statusBadgeClass(result.status)}">${escHtml(resultStatusLabel(result.status))}</span>`
        : '<span class="badge neutral">최근 실행 결과 없음</span>';
      const meta = `<div class="detail-meta">
        <span class="badge neutral">Row ${escHtml(agent.row + 1)}</span>
        <span class="badge neutral">${escHtml(modeLabel)}</span>
        ${resultBadge}
      </div>`;

      if (!result) {
        return `<h2>${escHtml(agent.name)}</h2>${meta}<div class="empty">이 에이전트의 최근 실행 결과가 없습니다.</div>`;
      }

      if (agent.mode === 'post') {
        return `<h2>${escHtml(agent.name)}</h2>${meta}
          ${detailBlockHtml('입력 응답', result.inputResponse || '(입력 응답 없음)')}
          ${detailBlockHtml('수정 후 응답', result.outputResponse || '(수정 후 응답 없음)')}
          ${result.error ? detailBlockHtml('오류', result.error) : ''}`;
      }

      const memoryBlocks = result.memoryEnabled
        ? `${detailBlockHtml('이전 기억', result.memoryPrevious || EMPTY_AGENT_MEMORY)}
           ${result.memoryFormat ? detailBlockHtml('기억 포맷', result.memoryFormat) : ''}
           ${detailBlockHtml('갱신된 기억', result.memoryUpdate || '(갱신된 기억 없음)')}
           ${detailBlockHtml('기억 저장 상태', memoryStatusLabel(result.memoryStatus))}`
        : '';

      return `<h2>${escHtml(agent.name)}</h2>${meta}
        ${detailBlockHtml('생성된 Note', result.content || '(노트 없음)')}
        ${detailBlockHtml('Raw Output', result.rawOutput || result.content || '(원본 출력 없음)')}
        ${memoryBlocks}
        ${result.error ? detailBlockHtml('오류', result.error) : ''}`;
    }

    function detailBlockHtml(title, text) {
      return `<div class="detail-block"><h3>${escHtml(title)}</h3><pre>${escHtml(text)}</pre></div>`;
    }

    function buildLiteUI(conf, pipeline) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101114;color:#eceff4;min-height:100vh;line-height:1.45}
.wrap{max-width:1120px;margin:0 auto;padding:22px 16px 84px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
h1{font-size:1.34rem;font-weight:720;letter-spacing:0;margin-bottom:4px}
.subtitle{color:#98a2b3;font-size:.84rem}
.header-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
.metric{background:#191b20;border:1px solid #292d35;border-radius:8px;padding:12px;min-height:72px}
.metric-label{font-size:.72rem;color:#8d96a5;margin-bottom:5px}
.metric-value{font-size:.92rem;font-weight:680;overflow-wrap:anywhere}
.metric-sub{font-size:.74rem;color:#a8b0bd;margin-top:2px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card{background:#191b20;border:1px solid #292d35;border-radius:8px;padding:14px;margin-bottom:12px}
.card h2{font-size:.91rem;margin-bottom:10px;color:#f2f4f7}
.card p{font-size:.82rem;color:#a8b0bd}
.kv{display:grid;grid-template-columns:110px minmax(0,1fr);gap:6px 8px;font-size:.8rem}
.k{color:#8792a2}.v{color:#dde3ec;overflow-wrap:anywhere}
.field{margin-bottom:10px}
label{display:block;font-size:.75rem;color:#9aa4b2;margin-bottom:4px}
input,select,textarea{width:100%;padding:9px 10px;border-radius:6px;border:1px solid #343944;background:#0f1115;color:#eef2f7;font-size:.86rem}
textarea{min-height:92px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:none;border-color:#5585d9}
.custom-provider,.vertex-credential{display:none;margin-top:8px}
.model-custom-input{display:none;margin-top:8px}
.model-custom-active .model-custom-input{display:block}
.credential-json{display:none}
.provider-custom-active .custom-provider{display:block}
.credential-vertex-active .api-key-credential{display:none}
.credential-vertex-active .vertex-credential{display:block}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.example-url{font-size:.73rem;color:#8d96a5;background:#111318;border:1px solid #272c34;border-radius:6px;padding:7px 9px;margin:-3px 0 10px;overflow-wrap:anywhere}
.msg{font-size:.82rem;padding:10px 12px;border-radius:8px;margin-bottom:12px;display:none}
.msg.ok{display:block;background:#10291e;color:#7ee2a8;border:1px solid #1d6b45}
.msg.err{display:block;background:#341515;color:#ff9b9b;border:1px solid #793333}
.badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:.72rem;font-weight:680}
.badge.ok{background:#123323;color:#6ee7a8}.badge.err{background:#3a1717;color:#ff8a8a}.badge.neutral{background:#27313c;color:#a8c7e6}
.error-text{color:#ff9b9b;overflow-wrap:anywhere}
.help-list{display:grid;gap:9px;font-size:.84rem;color:#c7ced9}.help-list li{margin-left:18px}
.actions{position:fixed;left:0;right:0;bottom:0;background:rgba(16,17,20,.96);border-top:1px solid #2a2e36;padding:10px 16px}
.pipeline-shell{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:12px;align-items:start}
.pipeline-rows{display:grid;gap:8px}
.pipeline-row{display:grid;grid-template-columns:92px minmax(0,1fr) 38px;gap:8px;align-items:center;background:#111318;border:1px solid #272c34;border-radius:8px;padding:9px}
.pipeline-row.main{border-color:#4b5565;background:#171a20}
.row-label{font-size:.77rem;color:#aab3c1;font-weight:720}.row-kind{font-size:.68rem;color:#7d8795;margin-top:2px}
.agent-lane{display:flex;gap:8px;flex-wrap:wrap;min-height:38px;align-items:center}
.agent-card{border:1px solid #373d48;background:#1b1f26;border-radius:7px;padding:8px 10px;min-width:150px;max-width:230px;cursor:pointer}
.agent-card:hover,.agent-card.selected{border-color:#5e91ee;background:#202838}.agent-card.disabled{opacity:.54}
.agent-name{font-size:.82rem;font-weight:720;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agent-meta{font-size:.69rem;color:#9ba6b5;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.main-chip{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border:1px solid #596171;background:#20242d;border-radius:7px;padding:8px 12px;font-size:.84rem;font-weight:760}
.add-agent{width:34px;height:34px;padding:0;text-align:center}.add-agent:disabled{opacity:.35;cursor:not-allowed}
.editor-empty{color:#9aa4b2;font-size:.84rem;padding:12px;border:1px dashed #363d47;border-radius:8px}
.checkline{display:flex;align-items:center;gap:7px;margin-bottom:8px;color:#c6ced9;font-size:.78rem}.checkline input{width:auto}
.memory-settings{border:1px solid #303640;background:#111318;border-radius:7px;padding:10px;margin:8px 0 10px}
.mini-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.danger{border-color:#6f3030;background:#351818;color:#ffb0b0}.danger:hover{background:#482020}
.preset-shell{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.3fr);gap:12px;align-items:start}
.preset-list{display:grid;gap:8px}.preset-item{border:1px solid #373d48;background:#111318;border-radius:7px;padding:9px 10px;cursor:pointer}
.preset-item:hover,.preset-item.selected{border-color:#5e91ee;background:#202838}.preset-title{font-size:.82rem;font-weight:720}.preset-meta{font-size:.7rem;color:#9ba6b5;margin-top:3px;overflow-wrap:anywhere}
.provider-key-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.64);z-index:40;display:flex;align-items:center;justify-content:center;padding:18px}
.prompt-modal{width:min(920px,100%);max-height:88vh;overflow:auto;background:#191b20;border:1px solid #343944;border-radius:8px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.42)}
.prompt-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.prompt-preview-meta{font-size:.76rem;color:#9aa4b2;margin-top:3px;overflow-wrap:anywhere}
.prompt-preview-block{background:#0f1115;border:1px solid #303640;border-radius:7px;padding:10px;margin-top:10px}
.prompt-preview-block h3{font-size:.78rem;color:#cbd5e1;margin-bottom:7px}
.prompt-preview-block pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;color:#eef2f7}
.actions-inner{max-width:1120px;margin:0 auto;display:flex;gap:8px;justify-content:flex-end}
button{padding:9px 14px;border-radius:7px;border:1px solid #343944;background:#20242b;color:#eef2f7;cursor:pointer;font-size:.86rem;font-weight:650}
button:hover{background:#2a3039}button.primary{background:#2f6fed;border-color:#2f6fed;color:#fff}button.primary:hover{background:#275fce}button.ghost{background:#15171b;color:#a8b0bd}
@media (max-width: 860px){.top{display:block}.header-actions{justify-content:flex-start;margin-top:12px}.status-strip,.grid,.row2,.pipeline-shell{grid-template-columns:1fr}.pipeline-row{grid-template-columns:72px minmax(0,1fr) 34px}}
</style></head><body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>Agents!</h1>
      <p class="subtitle">Row 1-4는 메인 모델 전 노트 생성, Row 5는 Main Model, Row 6-9는 응답 후처리입니다.</p>
    </div>
    <div class="header-actions">
      <button id="settings-tab-btn" class="primary">설정</button>
      <button id="run-inspector-tab-btn" class="ghost">Run Inspector</button>
      <button id="llm-test-btn">LLM 인증 테스트</button>
      <button id="all-test-btn" class="primary">전체 테스트</button>
    </div>
  </div>

  <div id="msg" class="msg"></div>
  <div id="test-results"></div>

  <div class="card">
    <h2>Pipeline Builder</h2>
    <div class="pipeline-shell">
      <div id="pipeline-rows" class="pipeline-rows"></div>
      <div id="agent-editor" class="card" style="margin-bottom:0"></div>
    </div>
  </div>

  <div class="card">
    <h2>Model Presets</h2>
    <div class="preset-shell">
      <div>
        <div id="preset-list" class="preset-list"></div>
        <div class="mini-actions">
          <button id="preset-add-btn">프리셋 추가</button>
        </div>
      </div>
      <div id="preset-editor"></div>
    </div>
  </div>

  <div class="card">
    <h2>공통 설정</h2>
    <div class="field">
      <label for="agent_debug_log">Debug Log</label>
      <select id="agent_debug_log">
        <option value="true" ${conf.debugLog ? 'selected' : ''}>켜짐 - 프롬프트 흐름을 콘솔에 출력</option>
        <option value="false" ${!conf.debugLog ? 'selected' : ''}>꺼짐</option>
      </select>
    </div>
  </div>

</div>

<div class="actions">
  <div class="actions-inner">
    <button id="close-btn" class="ghost">닫기</button>
    <button id="save-btn" class="primary">저장</button>
  </div>
</div>
</body></html>`;
    }

    function findFirstAgentId(pipeline) {
      for (const row of pipeline.rows || []) {
        const agent = (row.agents || [])[0];
        if (agent) return agent.id;
      }
      return null;
    }

    function findAgentById(pipeline, id) {
      if (!id) return null;
      for (const row of pipeline.rows || []) {
        const found = (row.agents || []).find(agent => agent.id === id);
        if (found) return found;
      }
      return null;
    }

    function setupLiteHandlers(initialConf, initialPipeline) {
      let modelPresetsState = normalizeModelPresets(JSON.parse(JSON.stringify(initialConf.modelPresets || [])), initialConf);
      let providerKeysState = { ...(initialConf.providerKeys || {}) };
      let selectedPresetId = modelPresetsState[0]?.id || DEFAULT_MODEL_PRESET_ID;
      let pipelineState = normalizePipelineConfig(JSON.parse(JSON.stringify(initialPipeline)), modelPresetsState, initialConf);
      let selectedAgentId = findFirstAgentId(pipelineState);

      setupProviderControls();
      setupCredentialFiles();
      setupEndpointExamples();
      renderPipeline();
      renderAgentEditor();
      renderPresetList();
      renderPresetEditor();

      document.getElementById('llm-test-btn')?.addEventListener('click', testSelectedPreset);
      document.getElementById('all-test-btn')?.addEventListener('click', testSelectedPreset);
      document.getElementById('run-inspector-tab-btn')?.addEventListener('click', openRunInspector);
      document.getElementById('preset-add-btn')?.addEventListener('click', addModelPreset);
      document.getElementById('save-btn')?.addEventListener('click', async () => {
        try {
          const next = collectLiteConfig(initialConf, pipelineState, modelPresetsState, providerKeysState);
          await saveLiteConfig(next);
          showMsg('저장 완료', true);
        } catch (err) {
          showMsg(`저장 오류: ${err.message}`, false);
        }
      });
      document.getElementById('close-btn')?.addEventListener('click', async () => {
          await Risuai.hideContainer();
      });

      function renderPipeline() {
        const root = document.getElementById('pipeline-rows');
        if (!root) return;

        root.innerHTML = pipelineState.rows.map((row) => {
          if (row.row === MAIN_ROW_INDEX) {
            return `<div class="pipeline-row main">
              <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">Fixed</div></div>
              <div class="agent-lane"><span class="main-chip">Main Model</span></div>
              <button class="add-agent" disabled>+</button>
            </div>`;
          }

          const mode = row.row < MAIN_ROW_INDEX ? 'Pre' : 'Post';
          const canAdd = row.row < MAIN_ROW_INDEX || row.agents.length === 0;
          const cards = row.agents.map(agent => agentCardHtml(agent)).join('');

          return `<div class="pipeline-row">
            <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">${mode}</div></div>
            <div class="agent-lane">${cards || '<span class="metric-sub">비어 있음</span>'}</div>
            <button class="add-agent" data-add-row="${row.row}" ${canAdd ? '' : 'disabled'}>+</button>
          </div>`;
        }).join('');

        root.querySelectorAll('[data-add-row]').forEach((button) => {
          button.addEventListener('click', () => addAgentToRow(parseInt(button.getAttribute('data-add-row'), 10)));
        });
        root.querySelectorAll('[data-agent-id]').forEach((card) => {
          card.addEventListener('click', () => {
            selectedAgentId = card.getAttribute('data-agent-id');
            renderPipeline();
            renderAgentEditor();
          });
        });
      }

      function agentCardHtml(agent) {
        const selected = agent.id === selectedAgentId ? ' selected' : '';
        const disabled = agent.enabled ? '' : ' disabled';
        const preset = findModelPreset(modelPresetsState, agent.modelPresetId);
        const model = preset.name || preset.model || 'model preset';
        const context = preset.contextWindow || 'ctx';
        const memory = agent.mode === 'pre' && agent.memoryEnabled ? ' · 기억' : '';
        return `<div class="agent-card${selected}${disabled}" data-agent-id="${escHtml(agent.id)}">
          <div class="agent-name">${escHtml(agent.name)}</div>
          <div class="agent-meta">${escHtml(model)} · ${escHtml(context)}${escHtml(memory)}</div>
        </div>`;
      }

      function renderAgentEditor() {
        const root = document.getElementById('agent-editor');
        if (!root) return;
        const agent = findAgentById(pipelineState, selectedAgentId);
        if (!agent) {
          root.innerHTML = '<h2>Agent Editor</h2><div class="editor-empty">에이전트 카드를 선택하거나 + 버튼으로 새 에이전트를 추가하세요.</div>';
          return;
        }

        const memoryEditor = agent.mode === 'pre'
          ? `<label class="checkline"><input id="edit_memoryEnabled" type="checkbox" ${agent.memoryEnabled ? 'checked' : ''}> 기억 활성화</label>
             ${agent.memoryEnabled ? `<div class="memory-settings">
               <div class="field"><label for="edit_memoryInstruction">기억 지시</label><textarea id="edit_memoryInstruction" placeholder="예: 스나가 만난 등장인물들을 기억하세요.">${escHtml(agent.memoryInstruction)}</textarea></div>
               <div class="field"><label for="edit_memoryFormat">기억 포맷</label><textarea id="edit_memoryFormat" placeholder="예: 이름만 쉼표로 구분해 작성하세요. 예: 하유희, 민수, 민지">${escHtml(agent.memoryFormat)}</textarea></div>
             </div>` : ''}`
          : '';

        root.innerHTML = `<h2>Agent Editor</h2>
          <div class="field"><label for="edit_name">Name</label><input id="edit_name" type="text" value="${escHtml(agent.name)}"></div>
          <label class="checkline"><input id="edit_enabled" type="checkbox" ${agent.enabled ? 'checked' : ''}> 활성화</label>
          <div class="field"><label for="edit_modelPresetId">Model Preset</label>${modelPresetSelect('edit_modelPresetId', agent.modelPresetId, modelPresetsState)}</div>
          <div class="field"><label for="edit_systemPrompt">System Prompt</label><textarea id="edit_systemPrompt">${escHtml(agent.systemPrompt)}</textarea></div>
          <div class="field"><label for="edit_outputInstruction">Output Instruction</label><textarea id="edit_outputInstruction">${escHtml(agent.outputInstruction)}</textarea></div>
          <label class="checkline"><input id="edit_includeSettingBlocks" type="checkbox" ${agent.includeSettingBlocks ? 'checked' : ''}> 설정 정보 포함</label>
          <label class="checkline"><input id="edit_includeHistory" type="checkbox" ${agent.includeHistory ? 'checked' : ''}> 최근 대화 포함</label>
          <label class="checkline"><input id="edit_includeUserInput" type="checkbox" ${agent.includeUserInput ? 'checked' : ''}> 현재 유저 입력 포함</label>
          <label class="checkline"><input id="edit_includePreviousNotes" type="checkbox" ${agent.includePreviousNotes ? 'checked' : ''}> 이전 노트 포함</label>
          ${memoryEditor}
          <div class="mini-actions">
            <button id="agent-preview-btn">프롬프트 확인</button>
            <button id="agent-left-btn">←</button>
            <button id="agent-right-btn">→</button>
            <button id="agent-delete-btn" class="danger">삭제</button>
          </div>`;

        bindEditorFields(agent);
      }

      function bindEditorFields(agent) {
        const textFields = ['name', 'systemPrompt', 'outputInstruction', 'memoryInstruction', 'memoryFormat'];
        textFields.forEach((field) => {
          document.getElementById(`edit_${field}`)?.addEventListener('input', (event) => {
            agent[field] = event.target.value;
            if (field === 'name') renderPipeline();
          });
        });

        document.getElementById('edit_modelPresetId')?.addEventListener('change', (event) => {
          agent.modelPresetId = event.target.value;
          renderPipeline();
        });

        ['enabled', 'includeSettingBlocks', 'includeHistory', 'includeUserInput', 'includePreviousNotes'].forEach((field) => {
          document.getElementById(`edit_${field}`)?.addEventListener('change', (event) => {
            agent[field] = event.target.checked;
            renderPipeline();
          });
        });

        document.getElementById('edit_memoryEnabled')?.addEventListener('change', (event) => {
          agent.memoryEnabled = event.target.checked;
          if (!agent.memoryInstruction) agent.memoryInstruction = '';
          if (!agent.memoryFormat) agent.memoryFormat = '';
          renderPipeline();
          renderAgentEditor();
        });

        document.getElementById('agent-preview-btn')?.addEventListener('click', () => showPromptPreview(agent));
        document.getElementById('agent-left-btn')?.addEventListener('click', () => moveAgent(agent, -1));
        document.getElementById('agent-right-btn')?.addEventListener('click', () => moveAgent(agent, 1));
        document.getElementById('agent-delete-btn')?.addEventListener('click', () => deleteAgent(agent));
      }

      function showPromptPreview(agent) {
        closePromptPreview();
        const promptMessages = buildAgentPrompt(agent, previewContextForAgent(agent));
        document.body.insertAdjacentHTML('beforeend', promptPreviewModalHtml(agent, promptMessages));
        document.getElementById('prompt-preview-close')?.addEventListener('click', closePromptPreview);
        document.getElementById('prompt-preview-backdrop')?.addEventListener('click', (event) => {
          if (event.target?.id === 'prompt-preview-backdrop') closePromptPreview();
        });
      }

      function previewContextForAgent(agent) {
        const placeholderNotes = agent.mode === 'post'
          ? [
              { row: 0, column: 0, name: '세계관 에이전트', content: '(메인 모델 전에 생성된 세계관 노트가 들어갑니다)' },
              { row: 1, column: 0, name: '플롯 에이전트', content: '(메인 모델 전에 생성된 플롯 노트가 들어갑니다)' },
            ]
          : [
              { row: Math.max(0, agent.row - 1), column: 0, name: '이전 Row 에이전트', content: '(이전 row까지 완료된 에이전트 노트가 row/column 순서로 들어갑니다)' },
            ];

        return {
          settingBlocks: [
            '[캐릭터 설명]',
            '(실제 채팅 실행 시 캐릭터 설명이 들어갑니다)',
            '',
            '[유저 설명]',
            '(선택된 페르소나 설명이 들어갑니다)',
            '',
            '[작가의 노트]',
            '(현재 채팅 작가의 노트가 들어갑니다)',
            '',
            '[현재 활성화된 로어북]',
            '(실제 요청에 포함된 활성 로어북이 들어갑니다)',
          ].join('\n'),
          history:
            '(선택한 Model Preset의 contextWindow 기준 최근 대화가 들어갑니다)',
          userInput:
            '(실제 사용자의 최신 입력이 들어갑니다)',
          notes: placeholderNotes,
          currentResponse:
            '(메인 모델 또는 이전 post-agent가 만든 현재 응답이 들어갑니다)',
          agentMemory:
            '(이 에이전트가 이 채팅방에서 저장한 이전 기억이 들어갑니다)',
        };
      }

      function promptPreviewModalHtml(agent, promptMessages) {
        const preset = findModelPreset(modelPresetsState, agent.modelPresetId);
        const systemMessage = promptMessages.find(message => message.role === 'system')?.content || '';
        const userMessage = promptMessages.find(message => message.role === 'user')?.content || '';
        const modeLabel = agent.mode === 'post' ? 'Post-Agent' : 'Pre-Agent';
        return `<div id="prompt-preview-backdrop" class="modal-backdrop">
          <div class="prompt-modal" role="dialog" aria-modal="true" aria-label="프롬프트 확인">
            <div class="prompt-modal-head">
              <div>
                <h2>프롬프트 확인</h2>
                <div class="prompt-preview-meta">${escHtml(agent.name)} · Row ${escHtml(agent.row + 1)} · ${escHtml(modeLabel)} · ${escHtml(preset.name || preset.model)}</div>
              </div>
              <button id="prompt-preview-close" class="ghost">닫기</button>
            </div>
            <div class="prompt-preview-block">
              <h3>system</h3>
              <pre>${escHtml(systemMessage)}</pre>
            </div>
            <div class="prompt-preview-block">
              <h3>user</h3>
              <pre>${escHtml(userMessage)}</pre>
            </div>
          </div>
        </div>`;
      }

      function closePromptPreview() {
        document.getElementById('prompt-preview-backdrop')?.remove();
      }

      function addAgentToRow(rowIndex) {
        if (rowIndex === MAIN_ROW_INDEX) return;
        const row = pipelineState.rows[rowIndex];
        if (rowIndex > MAIN_ROW_INDEX && row.agents.length > 0) return;

        const mode = rowIndex < MAIN_ROW_INDEX ? 'pre' : 'post';
        const agent = normalizeAgent({
          id: makeAgentId(mode),
          name: mode === 'pre' ? '새 노트 에이전트' : '새 후처리 에이전트',
          mode,
          systemPrompt: defaultSystemPromptForMode(mode),
          outputInstruction: mode === 'pre' ? DEFAULT_OUTPUT_PRE : DEFAULT_OUTPUT_POST,
          modelPresetId: modelPresetsState[0]?.id || DEFAULT_MODEL_PRESET_ID,
        }, rowIndex, row.agents.length);

        row.agents.push(agent);
        selectedAgentId = agent.id;
        pipelineState = normalizePipelineConfig(pipelineState, modelPresetsState, initialConf);
        renderPipeline();
        renderAgentEditor();
      }

      function moveAgent(agent, direction) {
        const row = pipelineState.rows[agent.row];
        const idx = row.agents.findIndex(item => item.id === agent.id);
        const nextIdx = idx + direction;
        if (idx < 0 || nextIdx < 0 || nextIdx >= row.agents.length) return;
        const next = row.agents[nextIdx];
        row.agents[nextIdx] = row.agents[idx];
        row.agents[idx] = next;
        row.agents.forEach((item, index) => {
          item.column = index;
        });
        pipelineState = normalizePipelineConfig(pipelineState, modelPresetsState, initialConf);
        renderPipeline();
        renderAgentEditor();
      }

      function deleteAgent(agent) {
        const row = pipelineState.rows[agent.row];
        row.agents = row.agents.filter(item => item.id !== agent.id);
        selectedAgentId = findFirstAgentId(pipelineState);
        pipelineState = normalizePipelineConfig(pipelineState, modelPresetsState, initialConf);
        renderPipeline();
        renderAgentEditor();
      }

      function renderPresetList() {
        const root = document.getElementById('preset-list');
        if (!root) return;
        root.innerHTML = modelPresetsState.map((preset) => {
          const selected = preset.id === selectedPresetId ? ' selected' : '';
          return `<div class="preset-item${selected}" data-preset-id="${escHtml(preset.id)}">
            <div class="preset-title">${escHtml(preset.name)}</div>
            <div class="preset-meta">${escHtml(preset.provider)} · ${escHtml(preset.model)}</div>
          </div>`;
        }).join('');
        root.querySelectorAll('[data-preset-id]').forEach((item) => {
          item.addEventListener('click', () => {
            selectedPresetId = item.getAttribute('data-preset-id');
            renderPresetList();
            renderPresetEditor();
          });
        });
      }

      function renderPresetEditor() {
        const root = document.getElementById('preset-editor');
        if (!root) return;
        const preset = findModelPreset(modelPresetsState, selectedPresetId);
        if (!preset) {
          root.innerHTML = '<div class="editor-empty">모델 프리셋을 추가하세요.</div>';
          return;
        }

        const hasKey = Boolean(providerKeysState[preset.provider]);
        const isVertex = isVertexProvider(preset.provider);
        const credentialInput = isVertex
          ? `<textarea id="preset_provider_key" placeholder="${hasKey ? 'Vertex credential JSON 저장됨. 새 JSON 입력 시 교체됩니다.' : 'Vertex service account JSON'}"></textarea>
             <input id="preset_provider_key_file" type="file" accept="application/json">`
          : `<input id="preset_provider_key" type="password" value="" placeholder="${hasKey ? '저장됨 - 새 값 입력 시 교체' : 'API key'}">`;

        root.innerHTML = `
          <div class="field"><label for="preset_name">Preset Name</label><input id="preset_name" type="text" value="${escHtml(preset.name)}"></div>
          <div class="field"><label for="preset_provider">Provider</label>${presetProviderSelect('preset_provider', preset.provider)}</div>
          <div class="field"><label for="preset_baseUrl">Endpoint Base URL</label><input id="preset_baseUrl" type="text" value="${escHtml(preset.baseUrl)}"></div>
          <div class="field"><label for="preset_model_select">Model</label>${modelSelect('preset_model', preset.provider, preset.model)}</div>
          <div class="row2">
            <div class="field"><label for="preset_temperature">Temperature</label><input id="preset_temperature" type="number" value="${escHtml(preset.temperature)}"></div>
            <div class="field"><label for="preset_maxTokens">Max Tokens</label><input id="preset_maxTokens" type="number" value="${escHtml(preset.maxTokens)}" placeholder="비우면 provider 기본값"></div>
          </div>
          <div class="field"><label for="preset_contextWindow">Context Window</label><input id="preset_contextWindow" type="number" min="1" value="${escHtml(preset.contextWindow)}"></div>
          <div class="provider-key-row">
            <div class="field"><label for="preset_provider_key">${escHtml(preset.provider)} API Key</label>${credentialInput}</div>
            <button id="preset-key-delete-btn" class="danger">키 삭제</button>
          </div>
          <div class="mini-actions">
            <button id="preset-delete-btn" class="danger">프리셋 삭제</button>
          </div>`;

        bindPresetEditor(preset);
      }

      function bindPresetEditor(preset) {
        ['name', 'baseUrl', 'temperature', 'maxTokens', 'contextWindow'].forEach((field) => {
          document.getElementById(`preset_${field}`)?.addEventListener('input', (event) => {
            preset[field] = field === 'baseUrl' ? normalizeUrl(event.target.value) : event.target.value;
            renderPipeline();
            renderPresetList();
          });
        });

        document.getElementById('preset_provider')?.addEventListener('change', (event) => {
          const previousModel = preset.model;
          preset.provider = event.target.value;
          const defaults = providerDefaults(preset.provider);
          if (defaults && shouldReplaceEndpoint(preset.baseUrl)) preset.baseUrl = defaults.baseUrl;
          if (defaults && shouldReplaceModel(previousModel)) preset.model = defaults.model;
          renderPipeline();
          renderPresetList();
          renderPresetEditor();
        });

        document.getElementById('preset_model_select')?.addEventListener('change', (event) => {
          const selected = event.target.value;
          const wrapper = document.querySelector('[data-model-field="preset_model"]');
          wrapper?.classList.toggle('model-custom-active', selected === 'custom');
          preset.model = getModelEditorValue('preset_model');
          renderPipeline();
          renderPresetList();
        });

        document.getElementById('preset_model_custom')?.addEventListener('input', (event) => {
          if (document.getElementById('preset_model_select')?.value === 'custom') {
            preset.model = event.target.value;
            renderPipeline();
            renderPresetList();
          }
        });

        document.getElementById('preset_provider_key')?.addEventListener('input', (event) => {
          const value = event.target.value;
          if (value) providerKeysState[preset.provider] = value;
        });

        document.getElementById('preset_provider_key_file')?.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          providerKeysState[preset.provider] = await file.text();
          showMsg('Vertex AI JSON credential을 불러왔습니다.', true);
          renderPresetEditor();
        });

        document.getElementById('preset-key-delete-btn')?.addEventListener('click', () => {
          delete providerKeysState[preset.provider];
          renderPresetEditor();
        });

        document.getElementById('preset-delete-btn')?.addEventListener('click', () => deleteModelPreset(preset));
      }

      function addModelPreset() {
        const preset = normalizeModelPreset({
          id: makeAgentId('preset'),
          name: `Model Preset ${modelPresetsState.length + 1}`,
          provider: DEFAULT_AGENT_PROVIDER,
          baseUrl: DEFAULT_AGENT_BASE_URL,
          model: DEFAULT_AGENT_MODEL,
          temperature: '0.7',
          maxTokens: '',
          contextWindow: '10',
        }, initialConf, modelPresetsState.length, new Set(modelPresetsState.map(item => item.id)));
        modelPresetsState.push(preset);
        selectedPresetId = preset.id;
        renderPresetList();
        renderPresetEditor();
      }

      function deleteModelPreset(preset) {
        if (modelPresetsState.length <= 1) {
          showMsg('최소 1개의 모델 프리셋은 필요합니다.', false);
          return;
        }
        modelPresetsState = modelPresetsState.filter(item => item.id !== preset.id);
        const fallbackId = modelPresetsState[0].id;
        pipelineState.rows.forEach((row) => {
          row.agents.forEach((agent) => {
            if (agent.modelPresetId === preset.id) agent.modelPresetId = fallbackId;
          });
        });
        selectedPresetId = fallbackId;
        renderPipeline();
        renderAgentEditor();
        renderPresetList();
        renderPresetEditor();
      }

      async function testSelectedPreset() {
        const preset = findModelPreset(modelPresetsState, selectedPresetId);
        const conf = {
          provider: preset.provider,
          baseUrl: normalizeUrl(preset.baseUrl || DEFAULT_AGENT_BASE_URL),
          apiKey: providerKeysState[preset.provider] || '',
          model: preset.model || DEFAULT_AGENT_MODEL,
        };

        if (!conf.apiKey) {
          showMsg(`${preset.provider} credential이 설정되지 않았습니다.`, false);
          setTestResults(testResultHtml(conf, false, null, null, 'Credential이 설정되지 않았습니다.'));
          return;
        }

        const started = Date.now();
        try {
          const result = await testProviderEndpoint(conf);
          const latency = Date.now() - started;
          showMsg('LLM 인증 테스트 성공', true);
          setTestResults(testResultHtml(conf, true, result.status, latency, '', result.url));
        } catch (err) {
          showMsg(`LLM 인증 테스트 실패: ${err.message}`, false);
          setTestResults(testResultHtml(conf, false, null, Date.now() - started, err.message, testEndpointUrl(conf)));
        }
      }
    }

    function modelPresetSelect(id, selectedId, presets) {
      return `<select id="${id}">${presets.map((preset) =>
        `<option value="${escHtml(preset.id)}" ${preset.id === selectedId ? 'selected' : ''}>${escHtml(preset.name)} - ${escHtml(preset.model)}</option>`
      ).join('')}</select>`;
    }

    function modelOptionsForProvider(provider) {
      return MODEL_SEED_CATALOG[normalizeProviderValue(provider)] || [];
    }

    function modelSelect(id, provider, model) {
      const options = modelOptionsForProvider(provider);
      const selectedModel = String(model || '');
      const known = options.includes(selectedModel);
      const customActive = selectedModel && !known;
      const selectedValue = customActive ? 'custom' : selectedModel || options[0] || 'custom';
      return `<div class="${customActive ? 'model-custom-active' : ''}" data-model-field="${escHtml(id)}">
        <select id="${id}_select">
          ${options.map(option =>
            `<option value="${escHtml(option)}" ${option === selectedValue ? 'selected' : ''}>${escHtml(option)}</option>`
          ).join('')}
          <option value="custom" ${selectedValue === 'custom' ? 'selected' : ''}>Custom...</option>
        </select>
        <input id="${id}_custom" class="model-custom-input" type="text" value="${escHtml(customActive ? selectedModel : '')}" placeholder="직접 모델명 입력">
      </div>`;
    }

    function getModelEditorValue(id) {
      const selected = document.getElementById(`${id}_select`)?.value || '';
      if (selected === 'custom') return getInputValue(`${id}_custom`);
      return selected;
    }

    function presetProviderSelect(id, value) {
      const normalized = normalizeProviderValue(value || DEFAULT_AGENT_PROVIDER);
      const options = providerOptions().filter(option => option.value !== 'custom');
      const known = options.some(option => option.value === normalized);
      const finalOptions = known ? options : [...options, { value: normalized, label: normalized }];
      return `<select id="${id}">${finalOptions.map(option =>
        `<option value="${escHtml(option.value)}" ${option.value === normalized ? 'selected' : ''}>${escHtml(option.label)}</option>`
      ).join('')}</select>`;
    }

    function collectLiteConfig(initialConf, pipeline, modelPresets, providerKeys) {
      const normalizedPresets = normalizeModelPresets(modelPresets, initialConf);
      const firstPreset = normalizedPresets[0] || defaultModelPreset(initialConf);
      const normalizedKeys = {};
      Object.keys(providerKeys || {}).forEach((key) => {
        const provider = normalizeProviderValue(key);
        const value = String(providerKeys[key] || '');
        if (provider && value) normalizedKeys[provider] = value;
      });
      return {
        provider: firstPreset.provider,
        baseUrl: normalizeUrl(firstPreset.baseUrl || DEFAULT_AGENT_BASE_URL),
        apiKey: normalizedKeys[firstPreset.provider] || initialConf.legacyApiKey || '',
        model: firstPreset.model || DEFAULT_AGENT_MODEL,
        temperature: parseAgentFloat(firstPreset.temperature, 0.7),
        maxTokens: parseOptionalInt(firstPreset.maxTokens),
        window: Math.max(1, parseInt(firstPreset.contextWindow, 10) || 10),
        debugLog: parseBool(getInputValue('agent_debug_log'), true),
        pipeline: normalizePipelineConfig(pipeline, normalizedPresets, initialConf),
        modelPresets: normalizedPresets,
        providerKeys: normalizedKeys,
      };
    }

    async function saveLiteConfig(conf) {
      await Risuai.setArgument('agent_provider', conf.provider);
      await Risuai.setArgument('agent_base_url', conf.baseUrl);
      await Risuai.setArgument('agent_api_key', '');
      await Risuai.setArgument('agent_model', conf.model);
      await Risuai.setArgument('agent_temperature', String(conf.temperature));
      await Risuai.setArgument('agent_max_tokens', conf.maxTokens === null ? '' : String(conf.maxTokens));
      await Risuai.setArgument('context_window', String(conf.window));
      await Risuai.setArgument('agent_debug_log', String(conf.debugLog));
      await Risuai.setArgument('agent_pipeline_json', JSON.stringify(conf.pipeline));
      await Risuai.setArgument('agent_model_presets_json', JSON.stringify(conf.modelPresets));
      await Risuai.setArgument('agent_provider_keys_json', JSON.stringify(conf.providerKeys));
    }

    async function testLiteLlm() {
      const conf = {
        provider: getProviderValue('agent_provider', DEFAULT_AGENT_PROVIDER),
        baseUrl: normalizeUrl(getInputValue('agent_base_url') || DEFAULT_AGENT_BASE_URL),
        apiKey: getCredentialValue('agent_api_key') || (await Risuai.getArgument('agent_api_key')) || '',
        model: getInputValue('agent_model') || DEFAULT_AGENT_MODEL,
      };

      if (!conf.apiKey) {
        showMsg('Credential이 설정되지 않았습니다.', false);
        setTestResults(testResultHtml(conf, false, null, null, 'Credential이 설정되지 않았습니다.'));
        return;
      }

      const started = Date.now();
      try {
        const result = await testProviderEndpoint(conf);
        const latency = Date.now() - started;
        showMsg('LLM 인증 테스트 성공', true);
        setTestResults(testResultHtml(conf, true, result.status, latency, '', result.url));
      } catch (err) {
        showMsg(`LLM 인증 테스트 실패: ${err.message}`, false);
        setTestResults(testResultHtml(conf, false, null, Date.now() - started, err.message, testEndpointUrl(conf)));
      }
    }

    async function testProviderEndpoint(conf) {
      if (isAnthropicProvider(conf.provider)) {
        const url = `${conf.baseUrl}/models/${conf.model}`;
        logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test Anthropic models start', url);
        const res = await Risuai.nativeFetch(url, {
          method: 'GET',
          headers: {
            'x-api-key': conf.apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        logAgentFetch({ ...conf, debugLog: true }, `LLM auth test Anthropic models response ${res.status}`, url);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
        }
        return { status: res.status, url };
      }

      if (isVertexProvider(conf.provider)) {
        logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test Vertex token start', 'https://oauth2.googleapis.com/token');
        await getVertexAccessToken(conf.apiKey);
        logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test Vertex token response 200', 'https://oauth2.googleapis.com/token');
        return { status: 200, url: 'https://oauth2.googleapis.com/token' };
      }

      const url = `${conf.baseUrl}/models`;
      logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test OpenAI-compatible models start', url);
      const res = await Risuai.nativeFetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${conf.apiKey}` },
      });
      logAgentFetch({ ...conf, debugLog: true }, `LLM auth test OpenAI-compatible models response ${res.status}`, url);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
      }
      return { status: res.status, url };
    }

    function testEndpointUrl(conf) {
      if (isAnthropicProvider(conf.provider)) return `${conf.baseUrl}/models/${conf.model}`;
      if (isVertexProvider(conf.provider)) return 'https://oauth2.googleapis.com/token';
      return `${conf.baseUrl}/models`;
    }

    function testResultHtml(conf, success, status, latency, error, urlOverride = null) {
      return `
        <div class="card">
          <h2>LLM 인증 테스트</h2>
          <div class="kv">
            <div class="k">결과</div><div class="v"><span class="badge ${success ? 'ok' : 'err'}">${success ? '성공' : '실패'}</span></div>
            <div class="k">Provider</div><div class="v">${escHtml(conf.provider)}</div>
            <div class="k">Model</div><div class="v">${escHtml(conf.model)}</div>
            <div class="k">URL</div><div class="v">${escHtml(urlOverride || testEndpointUrl(conf))}</div>
            <div class="k">HTTP</div><div class="v">${escHtml(status ?? '-')}</div>
            <div class="k">Latency</div><div class="v">${escHtml(latency ?? '-')}ms</div>
          </div>
          ${error ? `<div class="error-text" style="margin-top:10px">${escHtml(error)}</div>` : ''}
        </div>`;
    }

    function setTestResults(html) {
      const el = document.getElementById('test-results');
      if (el) el.innerHTML = html;
    }

    function showMsg(text, isOk) {
      const el = document.getElementById('msg');
      if (!el) return;
      el.textContent = text;
      el.className = `msg ${isOk ? 'ok' : 'err'}`;
      setTimeout(() => {
        if (el.textContent === text) el.className = 'msg';
      }, 4000);
    }

    function getInputValue(id) {
      return document.getElementById(id)?.value?.trim() || '';
    }

    function getProviderValue(id, fallback) {
      const selected = document.getElementById(`${id}_select`)?.value || '';
      if (selected === 'custom') return getInputValue(`${id}_custom`) || fallback || 'custom';
      return selected || fallback;
    }

    function getCredentialValue(id) {
      if (isVertexProvider(getProviderValue('agent_provider', DEFAULT_AGENT_PROVIDER))) {
        return document.getElementById(`${id}_json`)?.value?.trim() || getInputValue(id);
      }
      return getInputValue(id);
    }

    function providerSelect(id, value) {
      const options = providerOptions();
      const normalized = normalizeProviderValue(value || '');
      const known = options.some(option => option.value === normalized);
      const selected = known ? normalized : 'custom';
      const customValue = selected === 'custom' && value && !known ? value : '';
      return `
        <div class="provider-field" data-provider="${id}">
          <select id="${id}_select" data-provider-select="${id}">
            ${options.map(option => `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
          <input id="${id}_custom" class="custom-provider" type="text" value="${escHtml(customValue)}" placeholder="custom provider id">
        </div>`;
    }

    function credentialField(id, value) {
      return `
        <div class="field credential-field" data-credential="${id}">
          <div class="api-key-credential">
            <label for="${id}">API Key</label>
            <input id="${id}" type="password" value="" placeholder="${value ? '설정됨 - 비워두면 유지' : '입력 필요'}" autocomplete="off">
          </div>
          <div class="vertex-credential">
            <label for="${id}_file">Vertex AI Service Account JSON</label>
            <input id="${id}_file" type="file" accept="application/json,.json">
            <textarea id="${id}_json" class="credential-json" aria-label="Vertex AI service account JSON"></textarea>
            <div class="example-url">JSON 파일을 선택하면 credential로 저장됩니다. 원문은 화면에 표시하지 않습니다.</div>
          </div>
        </div>`;
    }

    function providerOptions() {
      return [
        { value: 'ollama', label: 'Ollama' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'claude', label: 'Claude' },
        { value: 'vertex-ai', label: 'Vertex AI' },
        { value: 'google', label: 'Google' },
        { value: 'custom', label: 'Custom' },
      ];
    }

    function providerDefaults(provider) {
      const normalized = normalizeProviderValue(provider);
      const defaults = {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4-mini',
        },
        ollama: {
          baseUrl: DEFAULT_AGENT_BASE_URL,
          model: DEFAULT_AGENT_MODEL,
        },
        claude: {
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        },
        'vertex-ai': {
          baseUrl: 'https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi',
          model: 'google/gemini-2.5-flash',
        },
        google: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-flash',
        },
      };
      return defaults[normalized] || null;
    }

    function knownProviderBaseUrls() {
      return Object.values({
        openai: providerDefaults('openai'),
        ollama: providerDefaults('ollama'),
        claude: providerDefaults('claude'),
        vertex: providerDefaults('vertex-ai'),
        google: providerDefaults('google'),
      }).map(item => item.baseUrl);
    }

    function setupProviderControls() {
      document.querySelectorAll('[data-provider-select]').forEach(select => {
        const update = () => {
          const id = select.dataset.providerSelect;
          const wrapper = document.querySelector(`[data-provider="${id}"]`);
          wrapper?.classList.toggle('provider-custom-active', select.value === 'custom');
          const credential = document.querySelector('[data-credential="agent_api_key"]');
          credential?.classList.toggle('credential-vertex-active', select.value === 'vertex-ai');
          applyProviderDefaults(select.value);
          updateEndpointExample('agent_base_url');
        };
        select.addEventListener('change', update);
        update();
      });
    }

    function applyProviderDefaults(provider) {
      if (!provider || provider === 'custom') return;
      const defaults = providerDefaults(provider);
      if (!defaults) return;

      const baseInput = document.getElementById('agent_base_url');
      const modelInput = document.getElementById('agent_model');
      if (baseInput && shouldReplaceEndpoint(baseInput.value)) {
        baseInput.value = defaults.baseUrl;
        updateEndpointExample('agent_base_url');
      }
      if (modelInput && shouldReplaceModel(modelInput.value)) {
        modelInput.value = defaults.model;
      }
    }

    function shouldReplaceEndpoint(value) {
      if (!String(value || '').trim()) return true;
      const normalized = normalizeUrl(value || '');
      return knownProviderBaseUrls().map(normalizeUrl).includes(normalized);
    }

    function shouldReplaceModel(value) {
      const normalized = String(value || '').trim();
      if (!normalized) return true;
      const knownModels = Object.values(MODEL_SEED_CATALOG).flat();
      return [
        DEFAULT_AGENT_MODEL,
        'gpt-4o-mini',
        'claude-3-5-sonnet-latest',
        'google/gemini-1.5-pro',
        'gemini-1.5-pro',
        ...knownModels,
      ].includes(normalized);
    }

    function setupEndpointExamples() {
      document.querySelectorAll('[data-example-for]').forEach(example => {
        const baseId = example.dataset.exampleFor;
        const input = document.getElementById(baseId);
        input?.addEventListener('input', () => updateEndpointExample(baseId));
        updateEndpointExample(baseId);
      });
    }

    function updateEndpointExample(baseId) {
      const example = document.querySelector(`[data-example-for="${baseId}"]`);
      const input = document.getElementById(baseId);
      if (!example || !input) return;
      example.textContent = `예시 URL: ${exampleApiUrl({
        provider: getProviderValue('agent_provider', DEFAULT_AGENT_PROVIDER),
        baseUrl: input.value || DEFAULT_AGENT_BASE_URL,
      })}`;
    }

    function setupCredentialFiles() {
      document.querySelectorAll('input[type="file"][id$="_file"]').forEach(input => {
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          const targetId = input.id.replace(/_file$/, '_json');
          const target = document.getElementById(targetId);
          if (target) target.value = text;
          showMsg('Vertex AI JSON credential을 불러왔습니다.', true);
        });
      });
    }

    function validateVertexCredential(text) {
      try {
        const parsed = JSON.parse(text);
        const missing = ['type', 'project_id', 'client_email', 'private_key'].filter(key => !parsed[key]);
        if (missing.length) {
          return { ok: false, error: `필수 필드 누락: ${missing.join(', ')}` };
        }
        return { ok: true, error: '' };
      } catch (err) {
        return { ok: false, error: `JSON 파싱 실패: ${err.message}` };
      }
    }

    async function getVertexAccessToken(text) {
      const now = Math.floor(Date.now() / 1000);
      if (vertexTokenCache?.source === text && vertexTokenCache.expiresAt > now + 60) {
        return vertexTokenCache.token;
      }

      const validation = validateVertexCredential(text);
      if (!validation.ok) throw new Error(validation.error);

      const info = JSON.parse(text);
      const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
      const claim = base64UrlJson({
        iss: info.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      });
      const unsigned = `${header}.${claim}`;
      const signature = await signRs256(unsigned, info.private_key);
      const assertion = `${unsigned}.${signature}`;
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      });

      const res = await Risuai.nativeFetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Vertex AI access token 발급 실패: HTTP ${res.status}: ${errText.slice(0, 180)}`);
      }

      const data = await res.json();
      if (!data.access_token) throw new Error('Vertex AI access token 응답이 비어 있습니다.');
      vertexTokenCache = {
        source: text,
        token: data.access_token,
        expiresAt: now + (data.expires_in || 3600),
      };
      return data.access_token;
    }

    async function signRs256(input, privateKeyPem) {
      const cryptoApi = globalThis.crypto?.subtle;
      if (!cryptoApi) throw new Error('이 환경에서는 WebCrypto 서명을 사용할 수 없어 Vertex AI Lite 호출을 실행할 수 없습니다.');

      const key = await cryptoApi.importKey(
        'pkcs8',
        pemToArrayBuffer(privateKeyPem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signature = await cryptoApi.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        new TextEncoder().encode(input),
      );
      return base64UrlBytes(new Uint8Array(signature));
    }

    function pemToArrayBuffer(pem) {
      const b64 = String(pem || '')
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\s/g, '');
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    function base64UrlJson(value) {
      return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
    }

    function base64UrlBytes(bytes) {
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    }

    function isAnthropicProvider(provider) {
      const normalized = normalizeProviderValue(provider);
      return normalized === 'anthropic' || normalized === 'claude';
    }

    function isVertexProvider(provider) {
      const normalized = normalizeProviderValue(provider);
      return normalized === 'vertex-ai' || normalized === 'vertex';
    }

    function normalizeProviderValue(value) {
      return String(value || '').trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
    }

    function normalizeUrl(url) {
      return String(url || DEFAULT_AGENT_BASE_URL).replace(/\/$/, '');
    }

    function exampleApiUrl(conf) {
      if (isAnthropicProvider(conf.provider)) return `${normalizeUrl(conf.baseUrl)}/messages`;
      return `${normalizeUrl(conf.baseUrl)}/chat/completions`;
    }

    function formatEndpoint(baseUrl) {
      try {
        const url = new URL(baseUrl);
        return url.host || baseUrl;
      } catch (_) {
        return baseUrl || '-';
      }
    }

    function parseOptionalInt(value) {
      const raw = String(value || '').trim();
      if (!raw) return null;
      const parsed = parseInt(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function parseBool(value, fallback) {
      const raw = String(value ?? '').trim().toLowerCase();
      if (!raw) return fallback;
      if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
      return fallback;
    }

    function requiredFloat(id, fallback) {
      const parsed = parseFloat(getInputValue(id));
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function logAgentFetch(conf, label, url, payload = null) {
      if (!conf?.debugLog) return;
      const info = {
        provider: conf.provider,
        model: conf.model,
        url,
      };
      if (payload) {
        info.messageCount = Array.isArray(payload.messages) ? payload.messages.length : undefined;
        info.temperature = payload.temperature;
        info.max_tokens = payload.max_tokens;
      }
      console.log(`MultiAgent fetch: ${label}`, info);
    }

    function logPromptFlow(label, messages, full = false) {
      const rows = messages.map((msg, idx) => {
        const content = String(msg?.content ?? '');
        return {
          idx,
          role: msg?.role ?? '(none)',
          chars: content.length,
          preview: content.slice(0, 220),
          content: full ? content : undefined,
        };
      });

      if (console.groupCollapsed) console.groupCollapsed(label);
      else console.log(label);

      console.table ? console.table(rows) : console.log(rows);
      if (full) {
        messages.forEach((msg, idx) => {
          console.log(`[${idx}] ${msg?.role ?? '(none)'} full content:`, String(msg?.content ?? ''));
        });
      }

      if (console.groupEnd) console.groupEnd();
    }

    function logTextBlock(label, text) {
      if (console.groupCollapsed) console.groupCollapsed(label);
      else console.log(label);
      console.log(String(text ?? ''));
      if (console.groupEnd) console.groupEnd();
    }

    function logSettingBlockStats(stats) {
      if (console.groupCollapsed) console.groupCollapsed('MultiAgent debug: setting block stats');
      else console.log('MultiAgent debug: setting block stats');
      console.log(`character: ${stats.character}`);
      console.log(`persona: ${stats.persona}`);
      console.log(`authorNote: ${stats.authorNote}`);
      console.log(`loreCandidates: ${stats.loreCandidates}`);
      console.log(`activeLorebooks: ${stats.activeLorebooks}`);
      if (console.groupEnd) console.groupEnd();
    }

    // ── beforeRequest / afterRequest 훅 등록 ─────────────────────────────────

    await Risuai.addRisuReplacer('beforeRequest', async (messages, type) => {
      try {
        const conf = await getConfig();
        const pipeline = await getPipelineConfig(conf);
        const runScope = await getAgentMemoryScope(conf.debugLog);

        if (!hasUsableProviderKeyForRows(pipeline, conf, 0, MAIN_ROW_INDEX - 1)) {
          console.log('MultiAgent: provider API key not set — pre-agent pipeline skipped');
          lastPipelineRun = createRunLogBase(type, pipeline, conf, runScope, 'skipped', 'pre-agent provider API key not set');
          lastPipelineRun.userInput = getUserInput(messages);
          await persistRunLog(lastPipelineRun, conf.debugLog);
          return messages;
        }

        const settingBlocks = await buildSettingBlocks(messages);

        if (conf.debugLog) {
          console.log('MultiAgent debug: beforeRequest type =', type);
          logPromptFlow('MultiAgent debug: RisuAI original messages', messages, true);
          logTextBlock('MultiAgent debug: setting blocks passed to agents', settingBlocks.content);
          logSettingBlockStats(settingBlocks.stats);
          logTextBlock('MultiAgent debug: current user input passed to agents', getUserInput(messages));
        }

        const notes = await runPrePipeline(messages, conf, pipeline, settingBlocks, type, runScope);
        const injectedMessages = injectAgentNotes(messages, notes);
        await persistRunLog(lastPipelineRun, conf.debugLog);
        if (conf.debugLog) logPromptFlow('MultiAgent debug: messages sent to main LLM after injection', injectedMessages, true);
        return injectedMessages;

      } catch (err) {
        // 에러 시 원본 메시지 그대로 통과 (파이프라인 실패가 채팅을 막지 않도록)
        console.log(`MultiAgent pipeline error: ${err.message}`);
        lastPipelineRun = null;
        return messages;
      }
    });

    await Risuai.addRisuReplacer('afterRequest', async (content, type) => {
      try {
        const conf = await getConfig();
        const pipeline = await getPipelineConfig(conf);
        const hasPostAgents = pipeline.rows
          .slice(MAIN_ROW_INDEX + 1)
          .some(row => (row.agents || []).some(agent => agent.enabled !== false));

        if (!hasPostAgents) {
          if (lastPipelineRun) {
            if (lastPipelineRun.status !== 'skipped') lastPipelineRun.status = 'complete';
            lastPipelineRun.finalResponse = String(content ?? '');
            await persistRunLog(lastPipelineRun, conf.debugLog);
          }
          return content;
        }

        if (!hasUsableProviderKeyForRows(pipeline, conf, MAIN_ROW_INDEX + 1, PIPELINE_ROW_COUNT - 1)) {
          console.log('MultiAgent: provider API key not set — post-agent pipeline skipped');
          if (lastPipelineRun) {
            lastPipelineRun.status = 'post-skipped';
            lastPipelineRun.reason = 'post-agent provider API key not set';
            lastPipelineRun.finalResponse = String(content ?? '');
            await persistRunLog(lastPipelineRun, conf.debugLog);
          }
          return content;
        }

        if (conf.debugLog) {
          console.log('MultiAgent debug: afterRequest type =', type);
          logTextBlock('MultiAgent debug: main model response before post-agents', content);
        }

        const finalContent = await runPostPipeline(content, conf, pipeline, type);
        await persistRunLog(lastPipelineRun, conf.debugLog);
        if (conf.debugLog) logTextBlock('MultiAgent debug: final response after post-agents', finalContent);
        return finalContent;
      } catch (err) {
        console.log(`MultiAgent afterRequest pipeline error: ${err.message}`);
        return content;
      }
    });

    console.log('Agents! v1.0.0 loaded');

  } catch (err) {
    console.log(`MultiAgent init error: ${err.message}`);
  }
})();
