//@name risu_agents
//@display-name Agents!
//@api 3.0
//@version 1.0.0
//@arg agents_provider string Analysis agent provider label. e.g. ollama
//@arg agents_base_url string Analysis agent API base URL. e.g. https://ollama.com/v1, https://api.openai.com/v1, https://api.anthropic.com/v1, or Vertex AI OpenAI-compatible endpoint
//@arg agents_api_key string Analysis agent API key
//@arg agents_model string Analysis agent model. e.g. gemini-3-flash-preview:cloud
//@arg agents_temperature string Analysis agent temperature (default: 0.7)
//@arg agents_max_tokens string Analysis agent max tokens (blank = provider default)
//@arg agents_context_window int Recent messages per agent (default: 10)
//@arg agents_debug_log string Print Agents! prompt flow to console. true/false (default: true)
//@arg agents_pipeline_json string Dynamic Agents! pipeline JSON
//@arg agents_model_presets_json string Model presets JSON
//@arg agents_provider_keys_json string Provider API keys JSON

/**
 * Agents! — RisuAI Plugin (Browser, API v3.0)
 *
 * 파이프라인:
 *   Row 1-4: pre-agent note generation
 *   Row 5: RisuAI main model
 *   Row 6-9: post-agent response editing
 *   Run Inspector: per-run prompts, outputs, and status
 *   Per-agent memory: optional note-backed memory for pre-agents
 */

(async () => {
  try {
    let vertexTokenCache = null;
    const DEFAULT_AGENT_PROVIDER = 'ollama';
    const DEFAULT_AGENT_BASE_URL = 'https://ollama.com/v1';
    const DEFAULT_AGENT_MODEL = 'gemini-3-flash-preview:cloud';
    const MASKED_SECRET = '*****';
    const DEFAULT_OLLAMA_GEMINI_PRESET_ID = 'preset-default-ollama-gemini-3-flash';
    const DEFAULT_OLLAMA_DEEPSEEK_PRESET_ID = 'preset-default-ollama-deepseek-v4-flash';
    const DEFAULT_MODEL_PRESET_ID = DEFAULT_OLLAMA_GEMINI_PRESET_ID;
    const DEFAULT_PROVIDER_ORDER = ['ollama', 'openai', 'claude', 'google', 'vertex-ai'];
    const EMPTY_AGENT_MEMORY = '(저장된 기억 없음)';
    const MEMORY_NOTE_TAG = 'AGENT_NOTE';
    const MEMORY_UPDATE_TAG = 'MEMORY_UPDATE';
    const MEMORY_STACK_VERSION = 3;
    const RUN_LOG_VERSION = 1;
    const PRE_REUSE_VERSION = 1;
    const PLUGIN_CHAT_ID_FIELD = 'risuAgentsChatId';
    const SETTINGS_UI_ID = 'risu-agents-settings';
    const HAMBURGER_UI_ID = 'risu-agents-hamburger';
    const CHAT_UI_ID = 'risu-agents-chat';
    const LEGACY_UI_IDS = ['risu-multiagent-lite-hamburger', 'risu-multiagent-lite-chat'];
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
      const provider = (await Risuai.getArgument('agents_provider')) || DEFAULT_AGENT_PROVIDER;
      const baseUrl = normalizeUrl((await Risuai.getArgument('agents_base_url')) || DEFAULT_AGENT_BASE_URL);
      const configuredApiKey  = (await Risuai.getArgument('agents_api_key'))  || '';
      const model   = (await Risuai.getArgument('agents_model'))    || DEFAULT_AGENT_MODEL;
      const temperature = parseFloat((await Risuai.getArgument('agents_temperature')) || '0.7');
      const maxTokens = parseOptionalInt(await Risuai.getArgument('agents_max_tokens'));
      const window  = Math.max(1, parseInt((await Risuai.getArgument('agents_context_window')) || '10') || 10);
      const debugLog = parseBool(await Risuai.getArgument('agents_debug_log'), true);
      const fallbackConfig = {
        provider,
        baseUrl,
        model,
        temperature: Number.isFinite(temperature) ? temperature : 0.7,
        maxTokens,
        window,
      };
      const providerKeys = parseProviderKeys(
        await Risuai.getArgument('agents_provider_keys_json'),
        provider,
        configuredApiKey,
        debugLog,
      );
      const modelPresets = parseModelPresets(
        await Risuai.getArgument('agents_model_presets_json'),
        fallbackConfig,
        debugLog,
      );
      const apiKey = getProviderApiKey(providerKeys, provider) || configuredApiKey;
      return {
        provider,
        baseUrl,
        apiKey,
        configuredApiKey,
        providerKeys,
        modelPresets,
        model,
        temperature: fallbackConfig.temperature,
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

    function parseProviderKeys(raw, configuredProvider, configuredApiKey, debugLog) {
      const keys = {};
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.keys(parsed).forEach((key) => {
              const provider = normalizeProviderValue(key);
              const value = String(parsed[key] || '');
              if (provider && value && value !== MASKED_SECRET) keys[provider] = value;
            });
          }
        } catch (err) {
          if (debugLog) console.log(`Agents! provider key JSON parse failed: ${err.message}`);
        }
      }

      const configuredKey = String(configuredApiKey || '');
      const normalizedConfiguredProvider = normalizeProviderValue(configuredProvider || DEFAULT_AGENT_PROVIDER);
      if (configuredKey && configuredKey !== MASKED_SECRET && normalizedConfiguredProvider && !keys[normalizedConfiguredProvider]) {
        keys[normalizedConfiguredProvider] = configuredKey;
      }
      return keys;
    }

    function parseModelPresets(raw, fallbackConfig, debugLog) {
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw));
          const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.presets) ? parsed.presets : [];
          const presets = normalizeModelPresets(source, fallbackConfig);
          if (presets.length > 0) return presets;
        } catch (err) {
          if (debugLog) console.log(`Agents! model preset JSON parse failed: ${err.message}`);
        }
      }
      return defaultModelPresets(fallbackConfig);
    }

    function normalizeModelPresets(source, fallbackConfig) {
      const used = new Set();
      const presets = (Array.isArray(source) ? source : [])
        .map((preset, idx) => normalizeModelPreset(preset, fallbackConfig, idx, used))
        .filter(Boolean);
      return ensureDefaultProviderPresets(presets, fallbackConfig, used);
    }

    function normalizeModelPreset(preset, fallbackConfig, idx, used) {
      const fallback = fallbackConfig || {};
      const baseId = String(preset?.id || (idx === 0 ? DEFAULT_MODEL_PRESET_ID : makeAgentId('preset')));
      let id = baseId;
      while (used.has(id)) id = `${baseId}-${used.size + 1}`;
      used.add(id);

      const provider = normalizeProviderValue(preset?.provider || fallback.provider || DEFAULT_AGENT_PROVIDER);
      const defaults = providerDefaults(provider);
      return {
        id,
        name: String(preset?.name || (idx === 0 ? 'Ollama' : `Model Preset ${idx + 1}`)),
        provider,
        baseUrl: normalizeUrl(defaults?.baseUrl || preset?.baseUrl || fallback.baseUrl || DEFAULT_AGENT_BASE_URL),
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

    function defaultModelPreset(fallbackConfig) {
      return defaultModelPresets(fallbackConfig)[0];
    }

    function defaultModelPresets(fallbackConfig) {
      const presets = [
        defaultOllamaModelPreset(
          DEFAULT_OLLAMA_GEMINI_PRESET_ID,
          'Ollama Gemini 3 Flash',
          'gemini-3-flash-preview:cloud',
          fallbackConfig,
        ),
        defaultOllamaModelPreset(
          DEFAULT_OLLAMA_DEEPSEEK_PRESET_ID,
          'Ollama DeepSeek V4 Flash',
          'deepseek-v4-flash:cloud',
          fallbackConfig,
        ),
      ];
      DEFAULT_PROVIDER_ORDER
        .filter(provider => provider !== DEFAULT_AGENT_PROVIDER)
        .forEach((provider, idx) => presets.push(defaultModelPresetForProvider(provider, fallbackConfig, idx)));
      return presets;
    }

    function defaultOllamaModelPreset(id, name, model, fallbackConfig) {
      return {
        id,
        name,
        provider: DEFAULT_AGENT_PROVIDER,
        baseUrl: normalizeUrl(DEFAULT_AGENT_BASE_URL),
        model,
        temperature: String(fallbackConfig?.temperature ?? 0.7),
        maxTokens: fallbackConfig?.maxTokens === null || fallbackConfig?.maxTokens === undefined ? '' : String(fallbackConfig.maxTokens),
        contextWindow: String(fallbackConfig?.window || 10),
      };
    }

    function defaultModelPresetForProvider(provider, fallbackConfig, idx = 0) {
      const normalized = normalizeProviderValue(provider || DEFAULT_AGENT_PROVIDER);
      const defaults = providerDefaults(normalized) || providerDefaults(DEFAULT_AGENT_PROVIDER);
      return {
        id: normalized === DEFAULT_AGENT_PROVIDER ? DEFAULT_MODEL_PRESET_ID : `preset-default-${normalized}`,
        name: defaultPresetName(normalized),
        provider: normalized,
        baseUrl: normalizeUrl(defaults.baseUrl),
        model: String(defaults.model),
        temperature: String(fallbackConfig?.temperature ?? 0.7),
        maxTokens: fallbackConfig?.maxTokens === null || fallbackConfig?.maxTokens === undefined ? '' : String(fallbackConfig.maxTokens),
        contextWindow: String(fallbackConfig?.window || 10),
      };
    }

    function ensureDefaultProviderPresets(presets, fallbackConfig, used = null) {
      const result = Array.isArray(presets) ? presets.slice() : [];
      const idSet = used || new Set(result.map(preset => preset.id));
      const existingProviders = new Set(result.map(preset => normalizeProviderValue(preset.provider)));

      [
        defaultOllamaModelPreset(
          DEFAULT_OLLAMA_GEMINI_PRESET_ID,
          'Ollama Gemini 3 Flash',
          'gemini-3-flash-preview:cloud',
          fallbackConfig,
        ),
        defaultOllamaModelPreset(
          DEFAULT_OLLAMA_DEEPSEEK_PRESET_ID,
          'Ollama DeepSeek V4 Flash',
          'deepseek-v4-flash:cloud',
          fallbackConfig,
        ),
      ].forEach((preset) => {
        if (idSet.has(preset.id)) return;
        result.push(preset);
        idSet.add(preset.id);
      });

      DEFAULT_PROVIDER_ORDER.filter(provider => provider !== DEFAULT_AGENT_PROVIDER).forEach((provider, idx) => {
        if (existingProviders.has(provider)) return;
        const preset = defaultModelPresetForProvider(provider, fallbackConfig, idx);
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

    async function loadActualChatContext(_requestMessages, debugLog) {
      const fallback = {
        available: false,
        messages: [],
        source: 'chat-message-unavailable',
        error: '',
        messageCount: 0,
        storedMessageCount: 0,
        appendedCurrentUser: false,
        trimmedToCurrentUser: false,
      };

      const errors = [];
      let characterIndex = null;
      let chatIndex = null;
      try {
        characterIndex = await Risuai.getCurrentCharacterIndex();
      } catch (err) {
        errors.push(`getCurrentCharacterIndex: ${err.message}`);
      }
      try {
        chatIndex = await Risuai.getCurrentChatIndex();
      } catch (err) {
        errors.push(`getCurrentChatIndex: ${err.message}`);
      }

      if (!Number.isFinite(Number(characterIndex)) || !Number.isFinite(Number(chatIndex))) {
        return {
          ...fallback,
          error: errors.join('; ') || 'current character/chat index unavailable',
        };
      }

      let chat = null;
      try {
        chat = await Risuai.getChatFromIndex(parseInt(characterIndex, 10), parseInt(chatIndex, 10));
      } catch (err) {
        return {
          ...fallback,
          error: `getChatFromIndex: ${err.message}`,
          characterIndex,
          chatIndex,
        };
      }

      if (!chat) {
        return {
          ...fallback,
          error: 'current chat object not found',
          characterIndex,
          chatIndex,
        };
      }

      const rawMessages = chat?.message;
      if (!Array.isArray(rawMessages)) {
        return {
          ...fallback,
          error: `chat.message array not found; keys=${objectKeysPreview(chat)}`,
          characterIndex,
          chatIndex,
        };
      }

      const normalizedMessages = rawMessages
        .map(normalizeStoredChatMessage)
        .filter(Boolean);
      const lastUserIndex = findLastIndex(normalizedMessages, msg => msg.role === 'user');
      if (lastUserIndex < 0) {
        return {
          ...fallback,
          source: 'chat.message',
          error: 'user message not found in chat.message',
          characterIndex,
          chatIndex,
          storedMessageCount: normalizedMessages.length,
        };
      }

      const trimmedToCurrentUser = lastUserIndex < normalizedMessages.length - 1;
      const messages = normalizedMessages.slice(0, lastUserIndex + 1);

      return {
        available: true,
        messages,
        source: `chat.message${trimmedToCurrentUser ? '+trimmed-to-last-user' : ''}`,
        error: '',
        characterIndex,
        chatIndex,
        messageCount: messages.length,
        storedMessageCount: normalizedMessages.length,
        appendedCurrentUser: false,
        trimmedToCurrentUser,
      };
    }

    function normalizeStoredChatMessage(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const rawRole = String(item.role || '').trim().toLowerCase().replace(/[_\s-]+/g, '');
      const role = rawRole === 'user'
        ? 'user'
        : ['assistant', 'char', 'character', 'bot', 'ai', 'model'].includes(rawRole)
          ? 'assistant'
          : '';
      if (!role) return null;
      const content = typeof item.data === 'string' || typeof item.data === 'number'
        ? String(item.data).trim()
        : '';
      return content ? { role, content } : null;
    }

    function objectKeysPreview(value) {
      return value && typeof value === 'object'
        ? Object.keys(value).slice(0, 12).join(',')
        : '';
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
        modelPresetId: DEFAULT_OLLAMA_GEMINI_PRESET_ID,
        systemPrompt:
          '당신은 세계관 일관성 에이전트입니다.\n' +
          '현재 요청을 세계관과 배경 설정 관점에서만 검토하고, 메인 모델이 참고할 짧은 메모를 작성하세요.\n' +
          '아래 포맷을 유지하되, 확실한 정보가 없거나 이번 장면에 중요하지 않은 항목은 "(해당 없음)"으로 둡니다.\n\n' +
          '[장면 환경]\n' +
          '- 장소, 시간대, 물리적 환경, 사회적 분위기\n\n' +
          '[적용되는 세계관 규칙]\n' +
          '- 기술, 마법, 제도, 문화, 금기, 능력의 한계\n\n' +
          '[기확립 설정]\n' +
          '- 이번 응답에서 지켜야 할 기존 사실과 조건',
      },
      {
        id: 'agent-plot',
        row: 1,
        column: 0,
        name: '플롯 에이전트',
        modelPresetId: DEFAULT_OLLAMA_DEEPSEEK_PRESET_ID,
        systemPrompt:
          '당신은 플롯 관리 에이전트입니다.\n' +
          '현재 서사 흐름, 장면 목적, 이번 장면에서 다룰 복선을 관리하는 메모를 작성하세요.\n' +
          '아래 포맷을 유지하되, 확실한 정보가 없거나 이번 장면에 중요하지 않은 항목은 "(해당 없음)"으로 둡니다.\n\n' +
          '[현재 서사 위치]\n' +
          '- 현재 아크, 직전 사건, 장면이 이어받은 상황\n\n' +
          '[이번 장면의 목적]\n' +
          '- 이번 응답이 서사적으로 진행하거나 보존해야 할 일\n\n' +
          '[긴장/갈등 포인트]\n' +
          '- 유지해야 할 갈등, 압박, 의문, 감정적 긴장\n\n' +
          '[이번 장면의 복선 처리]\n' +
          '- 이번 응답에서 회수, 암시, 강화, 또는 의도적으로 보류해야 할 복선만 작성\n\n' +
          '[권장 전개 초점]\n' +
          '- 다음 응답에서 자연스럽게 밀어줄 방향과 속도',
        memoryEnabled: true,
        memoryInstruction:
          '이 채팅의 장기 플롯 기억을 갱신하세요. 이후 턴에서 다시 참고해야 할 모든 복선, 미해결 질문, 장기 목표, 약속된 사건, 아직 공개되지 않은 정보를 유지합니다. 새로 등장한 복선은 추가하고, 이미 회수되었거나 더 이상 유효하지 않은 항목은 상태를 갱신하세요. 전체 복선 목록은 짧은 이름으로 압축해 컴마로 구분해 저장하세요.',
        memoryFormat:
          '[전체 복선 목록]\n' +
          '복선1, 복선2, 복선3\n\n' +
          '[활성 복선 상세]\n' +
          '- 항목: 현재 상태 / 관련 인물 / 마지막 근거\n\n' +
          '[미해결 질문]\n' +
          '- 질문: 현재 단서 / 다음에 확인할 점\n\n' +
          '[장기 목표와 약속]\n' +
          '- 목표 또는 약속: 관련 인물 / 진행 상태',
      },
      {
        id: 'agent-character',
        row: 2,
        column: 0,
        name: '캐릭터 에이전트',
        modelPresetId: DEFAULT_OLLAMA_DEEPSEEK_PRESET_ID,
        systemPrompt:
          '당신은 등장인물 에이전트입니다.\n' +
          '현재 장면에 등장하거나 직접 영향을 받는 인물들의 반응 기준을 정리하세요.\n' +
          '아래 포맷을 유지하되, 확실한 정보가 없거나 이번 장면에 중요하지 않은 항목은 "(해당 없음)"으로 둡니다.\n\n' +
          '[캐릭터별 현재 상태]\n' +
          '- 이름: 감정, 몸 상태, 처한 상황\n\n' +
          '[캐릭터별 욕구/목표]\n' +
          '- 이름: 지금 얻고 싶어 하는 것, 피하려는 것\n\n' +
          '[관계성 동역학]\n' +
          '- 인물 사이의 신뢰, 거리감, 긴장, 권력 관계\n' +
          '- 나이 차이, 가족/선후배/상하 관계, 언니/오빠/형/누나 같은 호칭 관계\n' +
          '- 존댓말/반말 여부와 호칭이 달라질 수 있는 조건\n\n' +
          '[행동 기준]\n' +
          '- 인물별 태도, 몸짓, 습관, 감정이 행동으로 드러나는 방식\n\n' +
          '[자연스러운 반응 범위]\n' +
          '- 이번 응답에서 납득 가능한 감정 변화와 행동 폭',
      },
      {
        id: 'agent-dialogue',
        row: 3,
        column: 0,
        name: '대사 에이전트',
        modelPresetId: DEFAULT_OLLAMA_GEMINI_PRESET_ID,
        systemPrompt:
          '당신은 대사와 말투 에이전트입니다.\n' +
          '세계관, 플롯, 캐릭터 메모를 바탕으로 이번 장면에서 참고할 발화 기준만 정리하세요.\n' +
          '아래 포맷을 유지하되, 확실한 정보가 없거나 이번 장면에 중요하지 않은 항목은 "(해당 없음)"으로 둡니다.\n\n' +
          '[캐릭터별 발화 기준]\n' +
          '- 이름: 호칭, 존댓말/반말, 문장 길이, 어휘 수준, 자주 쓰는 어미\n\n' +
          '[관계별 호칭과 말투]\n' +
          '- A -> B: 부르는 호칭, 높임/반말, 친밀도나 거리감이 드러나는 방식\n\n' +
          '[감정별 말투 변화]\n' +
          '- 이름: 평소 / 화났을 때 / 당황했을 때 / 친밀할 때의 말투 차이\n\n' +
          '[짧은 어조 샘플]\n' +
          '- 이름: 1문장 이하의 참고용 샘플. 장면을 진행하는 완성 대사가 아니라 어조 참고용으로만 작성',
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

    function normalizePipelineConfig(raw, modelPresets = null) {
      const fallback = createEmptyPipeline();
      const sourceRows = Array.isArray(raw?.rows) ? raw.rows : Array.isArray(raw) ? raw : [];

      for (let row = 0; row < PIPELINE_ROW_COUNT; row += 1) {
        const sourceRow = sourceRows.find(r => Number(r?.row) === row) || sourceRows[row] || {};
        const agents = Array.isArray(sourceRow?.agents) ? sourceRow.agents : [];
        const normalized = agents
          .map((agent, idx) => normalizeAgent(agent, row, idx, modelPresets))
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
      const raw = await Risuai.getArgument('agents_pipeline_json');
      if (!raw) return normalizePipelineConfig(defaultPipelineConfig(), conf?.modelPresets);

      try {
        return normalizePipelineConfig(JSON.parse(String(raw)), conf?.modelPresets);
      } catch (err) {
        if (conf?.debugLog) console.log(`Agents! pipeline JSON parse failed: ${err.message}`);
        return defaultPipelineConfig();
      }
    }

    function normalizeAgent(agent, row, column, modelPresets = null) {
      const mode = row < MAIN_ROW_INDEX ? 'pre' : 'post';
      const modelPresetId = resolveAgentPresetId(agent, modelPresets);
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

    function resolveAgentPresetId(agent, modelPresets) {
      const presets = Array.isArray(modelPresets) ? modelPresets : [];
      if (agent?.modelPresetId && presets.some(preset => preset.id === agent.modelPresetId)) {
        return String(agent.modelPresetId);
      }
      if (agent?.modelPresetId && presets.length === 0) {
        return String(agent.modelPresetId);
      }
      return presets[0]?.id || DEFAULT_MODEL_PRESET_ID;
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
      const errors = [];
      let character = null;
      try {
        character = await Risuai.getCharacter();
      } catch (err) {
        errors.push(`getCharacter: ${err.message}`);
        if (debugLog) console.log(`Agents! memory: getCharacter failed: ${err.message}`);
      }

      let characterIndex = null;
      try {
        characterIndex = await Risuai.getCurrentCharacterIndex();
      } catch (err) {
        errors.push(`getCurrentCharacterIndex: ${err.message}`);
        if (debugLog) console.log(`Agents! memory: getCurrentCharacterIndex failed: ${err.message}`);
      }

      let chatIndex = null;
      try {
        chatIndex = await Risuai.getCurrentChatIndex();
      } catch (err) {
        errors.push(`getCurrentChatIndex: ${err.message}`);
        if (debugLog) console.log(`Agents! memory: getCurrentChatIndex failed: ${err.message}`);
      }

      if (!Number.isFinite(Number(chatIndex))) {
        chatIndex = Number.isInteger(character?.chatPage) ? character.chatPage : 0;
      }

      const normalizedCharacterIndex = Number.isFinite(Number(characterIndex))
        ? Math.max(0, parseInt(characterIndex, 10) || 0)
        : null;
      const normalizedChatIndex = Math.max(0, parseInt(chatIndex, 10) || 0);
      const chats = Array.isArray(character?.chats) ? character.chats : [];
      let chat = null;
      if (normalizedCharacterIndex !== null && Number.isFinite(Number(chatIndex))) {
        try {
          chat = await Risuai.getChatFromIndex(normalizedCharacterIndex, normalizedChatIndex);
          if (!chat) errors.push('getChatFromIndex: current chat object not found');
        } catch (err) {
          errors.push(`getChatFromIndex: ${err.message}`);
          if (debugLog) console.log(`Agents! memory: getChatFromIndex failed: ${err.message}`);
        }
      } else {
        errors.push('current character/chat index unavailable');
      }

      const displayChat = chat || chats[normalizedChatIndex] || getCurrentCharacterChat(character);
      const chatIdentity = await ensureChatScopeIdentity(chat, normalizedCharacterIndex, normalizedChatIndex, debugLog, errors);
      const characterId = firstNonEmpty(character?.chaId, character?.id, character?.name, 'unknown-character');
      const characterName = firstNonEmpty(character?.name, '(알 수 없는 캐릭터)');
      const chatName = firstNonEmpty(displayChat?.name, displayChat?.title, displayChat?.chatName, `Chat ${normalizedChatIndex + 1}`);
      const chatScopeAvailable = Boolean(chatIdentity.key);
      const chatScopeError = chatScopeAvailable ? '' : errors.join('; ') || 'chat id unavailable';
      return {
        characterId: sanitizeMemoryKeyPart(characterId),
        characterIndex: normalizedCharacterIndex === null ? '' : String(normalizedCharacterIndex),
        chatIndex: String(normalizedChatIndex),
        chatKey: chatIdentity.key ? sanitizeMemoryKeyPart(chatIdentity.key) : '',
        chatKeyRaw: chatIdentity.key || '',
        chatKeyDisplay: chatIdentity.key ? formatChatKeyPreview(chatIdentity.key) : '',
        chatKeySource: chatIdentity.source || '',
        chatScopeAvailable,
        chatScopeError,
        characterName,
        chatName,
      };
    }

    async function ensureChatScopeIdentity(chat, characterIndex, chatIndex, debugLog, errors) {
      const existingId = firstNonEmpty(chat?.id);
      if (existingId) return { key: existingId, source: 'chat.id' };

      const pluginId = firstNonEmpty(chat?.[PLUGIN_CHAT_ID_FIELD]);
      if (pluginId) return { key: pluginId, source: PLUGIN_CHAT_ID_FIELD };

      if (!chat || characterIndex === null || !Number.isFinite(Number(chatIndex))) {
        return { key: '', source: '' };
      }

      const generatedId = makeAgentId('chat');
      try {
        const nextChat = Array.isArray(chat) ? [...chat] : { ...chat };
        nextChat[PLUGIN_CHAT_ID_FIELD] = generatedId;
        await Risuai.setChatToIndex(characterIndex, chatIndex, nextChat);
        if (debugLog) console.log(`Agents! memory: generated ${PLUGIN_CHAT_ID_FIELD} for chat scope`);
        return { key: generatedId, source: `${PLUGIN_CHAT_ID_FIELD}:generated` };
      } catch (err) {
        errors.push(`setChatToIndex: ${err.message}`);
        if (debugLog) console.log(`Agents! memory: setChatToIndex failed while saving chat scope id: ${err.message}`);
        return { key: '', source: '' };
      }
    }

    function sanitizeMemoryKeyPart(value) {
      return encodeURIComponent(String(value || 'unknown'));
    }

    function formatChatKeyPreview(value) {
      const text = String(value || '').trim();
      if (!text) return '';
      return text.length <= 22 ? text : `${text.slice(0, 12)}...${text.slice(-6)}`;
    }

    function agentMemoryKey(agent, scope) {
      if (!scope?.chatKey) return '';
      return `${'risu_agents_' + 'memory:'}${scope?.characterId || 'unknown-character'}:${scope.chatKey}:${sanitizeMemoryKeyPart(agent.id)}`;
    }

    function agentRunLogKey(scope) {
      if (!scope?.chatKey) return '';
      return `${'risu_agents_' + 'run:'}${scope?.characterId || 'unknown-character'}:${scope.chatKey}`;
    }

    function memoryChatMessages(messages) {
      return (Array.isArray(messages) ? messages : [])
        .filter(msg => msg?.role === 'user' || msg?.role === 'assistant')
        .map(msg => ({
          role: msg.role,
          content: String(msg.content || ''),
        }));
    }

    function memoryStateForMessages(messages, count = null) {
      const chatMessages = memoryChatMessages(messages);
      const messageCount = count === null
        ? chatMessages.length
        : Math.max(0, Math.min(chatMessages.length, parseInt(count, 10) || 0));
      const selected = chatMessages.slice(0, messageCount);
      return {
        messageCount,
        preview: memoryStatePreview(selected),
      };
    }

    function memoryStatePreview(messages) {
      const selected = Array.isArray(messages) ? messages : [];
      if (!selected.length) return '대화 시작 전';
      return selected
        .slice(-2)
        .map(msg => `${msg.role === 'user' ? '유저' : 'AI'}: ${String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 90)}`)
        .join('\n');
    }

    function normalizeMemorySnapshot(snapshot, fallbackState = null) {
      const value = String(snapshot?.value || '').trim();
      if (!value) return null;
      const state = fallbackState || {};
      const messageCount = Number.isFinite(Number(snapshot?.messageCount))
        ? Math.max(0, parseInt(snapshot.messageCount, 10) || 0)
        : Number.isFinite(Number(state.messageCount))
          ? Math.max(0, parseInt(state.messageCount, 10) || 0)
          : 0;
      return {
        messageCount,
        value,
        updatedAt: Number(snapshot?.updatedAt) || Date.now(),
        usedAt: Number(snapshot?.usedAt) || Number(snapshot?.updatedAt) || Date.now(),
        preview: String(snapshot?.preview || state.preview || '대화 시작 전'),
      };
    }

    function normalizeMemoryStore(raw, agent, scope) {
      const base = {
        version: MEMORY_STACK_VERSION,
        agentId: agent.id,
        agentName: agent.name,
        characterId: scope?.characterId || 'unknown-character',
        chatIndex: scope?.chatIndex || '0',
        chatKey: scope?.chatKey || '',
        chatKeyDisplay: scope?.chatKeyDisplay || '',
        chatKeySource: scope?.chatKeySource || '',
        pointer: -1,
        snapshots: [],
      };

      if (raw && typeof raw === 'object' && Array.isArray(raw.snapshots)) {
        const compacted = compactMemorySnapshots(raw.snapshots, parseInt(raw.pointer, 10));
        return {
          ...base,
          ...raw,
          version: MEMORY_STACK_VERSION,
          agentId: agent.id,
          agentName: agent.name,
          characterId: scope?.characterId || raw.characterId || base.characterId,
          chatIndex: scope?.chatIndex || raw.chatIndex || base.chatIndex,
          chatKey: scope?.chatKey || raw.chatKey || base.chatKey,
          chatKeyDisplay: scope?.chatKeyDisplay || raw.chatKeyDisplay || base.chatKeyDisplay,
          chatKeySource: scope?.chatKeySource || raw.chatKeySource || base.chatKeySource,
          pointer: compacted.pointer,
          snapshots: compacted.snapshots,
        };
      }

      const legacyValue = raw && typeof raw === 'object' && raw !== null
        ? String(raw.value || '').trim()
        : String(raw || '').trim();
      if (!legacyValue) return base;

      const baselineState = memoryStateForMessages([], 0);
      const snapshot = normalizeMemorySnapshot({
        value: legacyValue,
        updatedAt: raw?.updatedAt,
        usedAt: raw?.updatedAt,
      }, {
        ...baselineState,
        preview: '기존 단일 기억에서 승격됨',
      });
      return {
        ...base,
        pointer: 0,
        snapshots: snapshot ? [snapshot] : [],
      };
    }

    function compactMemorySnapshots(sourceSnapshots, preferredPointer = -1) {
      const normalized = (Array.isArray(sourceSnapshots) ? sourceSnapshots : [])
        .map((snapshot, idx) => ({ snapshot: normalizeMemorySnapshot(snapshot), idx }))
        .filter(item => item.snapshot);
      const explicitNoPointer = Number(preferredPointer) === -1;
      const hasPreferredPointer = Number.isFinite(Number(preferredPointer)) && Number(preferredPointer) >= 0;
      const preferred = hasPreferredPointer
        ? normalized.find(item => item.idx === preferredPointer)?.snapshot || null
        : null;
      const byCount = new Map();

      normalized.forEach((item) => {
        const count = item.snapshot.messageCount;
        const existing = byCount.get(count);
        if (!existing || shouldReplaceMemorySnapshot(existing, item, preferredPointer)) {
          byCount.set(count, item);
        }
      });

      const snapshots = [...byCount.values()]
        .map(item => item.snapshot)
        .sort((a, b) => a.messageCount - b.messageCount);
      const preferredCount = preferred?.messageCount;
      const pointer = explicitNoPointer
        ? -1
        : Number.isFinite(Number(preferredCount))
          ? snapshots.findIndex(snapshot => snapshot.messageCount === preferredCount)
          : snapshots.length - 1;
      return {
        snapshots,
        pointer: snapshots.length && pointer >= 0 ? pointer : -1,
      };
    }

    function shouldReplaceMemorySnapshot(existing, candidate, preferredPointer) {
      if (candidate.idx === preferredPointer) return true;
      if (existing.idx === preferredPointer) return false;
      const existingTime = Number(existing.snapshot.usedAt || existing.snapshot.updatedAt) || 0;
      const candidateTime = Number(candidate.snapshot.usedAt || candidate.snapshot.updatedAt) || 0;
      return candidateTime >= existingTime;
    }

    function findMemorySnapshotIndexForCount(store, messageCount) {
      const snapshots = Array.isArray(store?.snapshots) ? store.snapshots : [];
      const count = Math.max(0, parseInt(messageCount, 10) || 0);
      let found = -1;
      snapshots.forEach((snapshot, idx) => {
        if (Number(snapshot.messageCount) <= count) found = idx;
      });
      return found;
    }

    function currentMemorySnapshot(store) {
      const snapshots = Array.isArray(store?.snapshots) ? store.snapshots : [];
      const pointer = parseInt(store?.pointer, 10);
      return Number.isFinite(pointer) && pointer >= 0 ? snapshots[pointer] || null : null;
    }

    async function persistMemoryStore(key, store, debugLog) {
      try {
        await Risuai.pluginStorage.setItem(key, store);
        return true;
      } catch (err) {
        if (debugLog) console.log(`Agents! memory stack save failed: ${err.message}`);
        return false;
      }
    }

    async function loadAgentMemory(agent, scope, messages, debugLog) {
      if (!agent.memoryEnabled || agent.mode !== 'pre') {
        return { enabled: false, value: '', key: '' };
      }

      const key = agentMemoryKey(agent, scope || {});
      const currentState = memoryStateForMessages(messages);
      if (!key) {
        if (debugLog) console.log(`Agents! memory load skipped (${agent.name}): chat scope unavailable`);
        return {
          enabled: true,
          key: '',
          value: '',
          store: normalizeMemoryStore(null, agent, scope || {}),
          currentState,
          pointer: -1,
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
          chatKey: scope?.chatKey || '',
          chatScopeUnavailable: true,
          unavailableReason: scope?.chatScopeError || 'chat-scope-unavailable',
        };
      }
      try {
        const raw = await Risuai.pluginStorage.getItem(key);
        const store = normalizeMemoryStore(raw, agent, scope || {});
        const previousPointer = store.pointer;
        const matchIndex = findMemorySnapshotIndexForCount(store, currentState.messageCount);
        if (matchIndex >= 0) {
          store.pointer = matchIndex;
          store.snapshots[matchIndex].usedAt = Date.now();
        } else {
          store.pointer = -1;
        }

        const migrated = raw && !(typeof raw === 'object' && raw !== null && raw.version === MEMORY_STACK_VERSION);
        if (migrated || previousPointer !== store.pointer || matchIndex >= 0) {
          store.updatedAt = Date.now();
          await persistMemoryStore(key, store, debugLog);
        }

        const snapshot = currentMemorySnapshot(store);
        const value = String(snapshot?.value || '').trim();
        if (debugLog) console.log(`Agents! memory loaded (${agent.name}): ${value ? 'found' : 'empty'} ${key}`);
        return {
          enabled: true,
          key,
          value,
          store,
          currentState,
          pointer: store.pointer,
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
          chatKey: scope?.chatKey || '',
        };
      } catch (err) {
        if (debugLog) console.log(`Agents! memory load failed (${agent.name}): ${err.message}`);
        return {
          enabled: true,
          key,
          value: '',
          store: normalizeMemoryStore(null, agent, scope || {}),
          currentState,
          pointer: -1,
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
          chatKey: scope?.chatKey || '',
          failed: true,
        };
      }
    }

    async function loadAgentMemoryReadOnly(agent, scope, debugLog, reason = 'chat-context-unavailable') {
      if (!agent.memoryEnabled || agent.mode !== 'pre') {
        return { enabled: false, value: '', key: '' };
      }

      const key = agentMemoryKey(agent, scope || {});
      if (!key) {
        if (debugLog) console.log(`Agents! memory read-only skipped (${agent.name}): chat scope unavailable; ${reason}`);
        return {
          enabled: true,
          key: '',
          value: '',
          store: normalizeMemoryStore(null, agent, scope || {}),
          currentState: null,
          pointer: -1,
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
          chatKey: scope?.chatKey || '',
          chatContextUnavailable: true,
          chatScopeUnavailable: true,
          unavailableReason: reason || scope?.chatScopeError || 'chat-scope-unavailable',
        };
      }
      try {
        const raw = await Risuai.pluginStorage.getItem(key);
        const store = normalizeMemoryStore(raw, agent, scope || {});
        const snapshot = currentMemorySnapshot(store);
        const value = String(snapshot?.value || '').trim();
        if (debugLog) console.log(`Agents! memory read-only (${agent.name}): ${value ? 'found' : 'empty'} ${key}; ${reason}`);
        return {
          enabled: true,
          key,
          value,
          store,
          currentState: null,
          pointer: store.pointer,
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
          chatKey: scope?.chatKey || '',
          chatContextUnavailable: true,
          unavailableReason: reason,
        };
      } catch (err) {
        if (debugLog) console.log(`Agents! memory read-only load failed (${agent.name}): ${err.message}`);
        return {
          enabled: true,
          key,
          value: '',
          store: normalizeMemoryStore(null, agent, scope || {}),
          currentState: null,
          pointer: -1,
          characterId: scope?.characterId || 'unknown-character',
          chatIndex: scope?.chatIndex || '0',
          chatKey: scope?.chatKey || '',
          chatContextUnavailable: true,
          unavailableReason: reason,
          failed: true,
        };
      }
    }

    async function saveAgentMemory(agent, memory, memoryUpdate, debugLog) {
      if (!memory?.enabled || !memory.key) return false;
      if (memory.chatContextUnavailable || memory.chatScopeUnavailable || !memory.currentState) {
        if (debugLog) console.log(`Agents! memory save skipped (${agent.name}): ${memory.unavailableReason || 'context unavailable'}`);
        return false;
      }
      const nextMemory = String(memoryUpdate || '').trim();
      if (!nextMemory) {
        if (debugLog) console.log(`Agents! memory update empty (${agent.name}); keeping previous memory`);
        return false;
      }

      try {
        const store = normalizeMemoryStore(memory.store, agent, memory);
        const state = memory.currentState || memoryStateForMessages([]);
        const now = Date.now();
        const snapshot = {
          messageCount: state.messageCount,
          preview: state.preview,
          value: nextMemory,
          updatedAt: now,
          usedAt: now,
        };
        const keepUntil = Number.isFinite(Number(store.pointer)) && store.pointer >= 0
          ? store.pointer + 1
          : 0;
        store.snapshots = store.snapshots.slice(0, keepUntil);
        const existingIndex = store.snapshots.findIndex(item => item.messageCount === state.messageCount);
        if (existingIndex >= 0) {
          store.snapshots[existingIndex] = {
            ...store.snapshots[existingIndex],
            ...snapshot,
          };
          store.pointer = existingIndex;
        } else {
          store.snapshots.push(snapshot);
          store.pointer = store.snapshots.length - 1;
        }
        const compacted = compactMemorySnapshots(store.snapshots, store.pointer);
        store.snapshots = compacted.snapshots;
        store.pointer = compacted.pointer;

        store.version = MEMORY_STACK_VERSION;
        store.agentId = agent.id;
        store.agentName = agent.name;
        store.characterId = memory.characterId;
        store.chatIndex = memory.chatIndex;
        store.chatKey = memory.chatKey || '';
        store.updatedAt = now;
        await Risuai.pluginStorage.setItem(memory.key, {
          ...store,
          updatedAt: Date.now(),
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
        chatKey: scope?.chatKey || '',
        chatKeyDisplay: scope?.chatKeyDisplay || '',
        chatKeySource: scope?.chatKeySource || '',
        chatScopeAvailable: scope?.chatScopeAvailable !== false && Boolean(scope?.chatKey),
        chatScopeError: scope?.chatScopeError || '',
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
        preReuseVersion: PRE_REUSE_VERSION,
        preReuseKey: '',
        preReused: false,
        preReusedFrom: '',
        timestamp: Date.now(),
        updatedAt: Date.now(),
      };
    }

    function runChatContextMeta(chatContext) {
      return {
        chatContextAvailable: Boolean(chatContext?.available),
        chatContextSource: chatContext?.source || '',
        chatContextError: chatContext?.error || '',
        chatContextMessageCount: chatContext?.messageCount ?? 0,
        chatContextStoredMessageCount: chatContext?.storedMessageCount ?? null,
        chatContextAppendedCurrentUser: Boolean(chatContext?.appendedCurrentUser),
      };
    }

    function buildPreReuseKey(scope, chatContext, settingBlocks, pipeline, conf) {
      if (chatContext?.available !== true || !scope?.chatKey) return '';
      const contextMessages = Array.isArray(chatContext.messages)
        ? chatContext.messages.map(msg => ({
          role: msg.role,
          content: String(msg.content || ''),
        }))
        : [];
      const preAgents = [];
      for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
        getEnabledAgentsForRow(pipeline, row).forEach((agent) => {
          const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
          preAgents.push({
            id: agent.id,
            row: agent.row,
            column: agent.column,
            enabled: agent.enabled !== false,
            modelPresetId: agent.modelPresetId,
            systemPrompt: agent.systemPrompt || '',
            outputInstruction: agent.outputInstruction || '',
            includeSettingBlocks: Boolean(agent.includeSettingBlocks),
            includeHistory: Boolean(agent.includeHistory),
            includeUserInput: Boolean(agent.includeUserInput),
            includePreviousNotes: Boolean(agent.includePreviousNotes),
            memoryEnabled: Boolean(agent.mode === 'pre' && agent.memoryEnabled),
            memoryInstruction: agent.memoryInstruction || '',
            memoryFormat: agent.memoryFormat || '',
            preset: {
              provider: preset?.provider || '',
              model: preset?.model || '',
              baseUrl: preset?.baseUrl || '',
              temperature: String(preset?.temperature ?? ''),
              maxTokens: String(preset?.maxTokens ?? ''),
              contextWindow: String(preset?.contextWindow ?? ''),
            },
          });
        });
      }

      const payload = {
        version: PRE_REUSE_VERSION,
        chatKey: scope.chatKey,
        chatContextMessageCount: chatContext.messageCount ?? contextMessages.length,
        messages: contextMessages,
        userInput: getUserInput(contextMessages),
        settingBlocks: settingBlocks?.content || '',
        preAgents,
      };
      return `v${PRE_REUSE_VERSION}:${hashStablePayload(payload)}`;
    }

    function hashStablePayload(value) {
      const text = stableStringify(value);
      let hash = 2166136261;
      for (let idx = 0; idx < text.length; idx += 1) {
        hash ^= text.charCodeAt(idx);
        hash = Math.imul(hash, 16777619);
      }
      return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
    }

    function stableStringify(value) {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    async function loadRunLogForScope(scope, debugLog) {
      const key = agentRunLogKey(scope || {});
      if (!key) return null;
      try {
        const run = await Risuai.pluginStorage.getItem(key);
        return run && typeof run === 'object' ? { ...run, runKey: run.runKey || key } : null;
      } catch (err) {
        if (debugLog) console.log(`Agents! pre-agent reuse load failed: ${err.message}`);
        return null;
      }
    }

    function findReusablePreRun(previousRun, preReuseKey) {
      if (!preReuseKey || !previousRun || previousRun.preReuseKey !== preReuseKey) return null;
      const notes = Array.isArray(previousRun.notes) ? previousRun.notes : [];
      if (!notes.some(note => String(note?.content || '').trim())) return null;
      const preResults = Array.isArray(previousRun.preResults) ? previousRun.preResults : [];
      if (!preResults.some(result => result?.status === 'success' || result?.status === 'skipped')) return null;
      return previousRun;
    }

    function createPreReusedRunLog(type, pipeline, conf, scope, chatContext, settingBlocks, previousRun, preReuseKey) {
      const notes = JSON.parse(JSON.stringify(previousRun.notes || []));
      const preResults = JSON.parse(JSON.stringify(previousRun.preResults || [])).map(result => ({
        ...result,
        reused: true,
        memoryStatus: result.memoryStatus && result.memoryStatus !== 'disabled' ? 'reused' : result.memoryStatus,
        memoryUpdated: false,
      }));
      const run = createRunLogBase(type, pipeline, conf, scope, 'pre-reused', 'pre-agent results reused');
      return {
        ...run,
        pipelineSnapshot: JSON.parse(JSON.stringify(pipeline)),
        settingBlocks: settingBlocks.content,
        settingBlockStats: settingBlocks.stats,
        ...runChatContextMeta(chatContext),
        preReuseVersion: PRE_REUSE_VERSION,
        preReuseKey,
        preReused: true,
        preReusedFrom: previousRun.preReusedFrom || previousRun.updatedAt || previousRun.timestamp || '',
        preResults,
        postResults: [],
        notes,
        userInput: getUserInput(chatContext.messages),
        finalResponse: '',
      };
    }

    async function persistRunLog(run, debugLog) {
      if (!run?.runKey) {
        if (debugLog) console.log('Agents! run log save skipped: chat scope unavailable');
        return false;
      }
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
      if (!key) {
        return {
          version: RUN_LOG_VERSION,
          status: 'chat-scope-unavailable',
          reason: scope.chatScopeError || 'chat id unavailable',
          characterId: scope.characterId,
          chatIndex: scope.chatIndex,
          chatKey: '',
          chatKeyDisplay: '',
          chatKeySource: '',
          chatScopeAvailable: false,
          chatScopeError: scope.chatScopeError || 'chat id unavailable',
          characterName: scope.characterName,
          chatName: scope.chatName,
          runKey: '',
          preResults: [],
          postResults: [],
          notes: [],
        };
      }
      try {
        const run = await Risuai.pluginStorage.getItem(key);
        if (run && typeof run === 'object') {
          return {
            ...run,
            runKey: run.runKey || key,
            characterName: run.characterName || scope.characterName,
            chatName: run.chatName || scope.chatName,
            chatIndex: scope.chatIndex,
            chatKey: scope.chatKey,
            chatKeyDisplay: scope.chatKeyDisplay,
            chatKeySource: scope.chatKeySource,
            chatScopeAvailable: true,
            chatScopeError: '',
          };
        }
        return {
          version: RUN_LOG_VERSION,
          status: 'no-run',
          reason: '',
          characterId: scope.characterId,
          chatIndex: scope.chatIndex,
          chatKey: scope.chatKey,
          chatKeyDisplay: scope.chatKeyDisplay,
          chatKeySource: scope.chatKeySource,
          chatScopeAvailable: true,
          chatScopeError: '',
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
          chatKey: scope.chatKey,
          chatKeyDisplay: scope.chatKeyDisplay,
          chatKeySource: scope.chatKeySource,
          chatScopeAvailable: true,
          chatScopeError: '',
          characterName: scope.characterName,
          chatName: scope.chatName,
          runKey: key,
          preResults: [],
          postResults: [],
          notes: [],
        };
      }
    }

    async function runPrePipeline(_requestMessages, chatContext, conf, pipeline, settingBlocks, type, runScope, preReuseKey = '') {
      const contextMessages = chatContext?.available === true && Array.isArray(chatContext?.messages)
        ? chatContext.messages
        : [];
      const memoryScope = hasMemoryEnabledPreAgents(pipeline)
        ? runScope || await getAgentMemoryScope(conf.debugLog)
        : null;
      const memoryCanWrite = chatContext?.available === true && memoryScope?.chatScopeAvailable !== false && Boolean(memoryScope?.chatKey);
      const memoryUnavailableReason = chatContext?.available !== true
        ? chatContext?.error || 'chat-context-unavailable'
        : memoryScope?.chatScopeError || 'chat-scope-unavailable';
      const notes = [];
      const userInput = getUserInput(contextMessages);
      const preResults = [];

      if (chatContext?.available !== true) {
        const skipText = `(스킵: 실제 채팅방 대화 컨텍스트 없음 - ${memoryUnavailableReason})`;
        for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
          const agents = getEnabledAgentsForRow(pipeline, row);
          preResults.push(...agents.map(agent => ({
            ...runAgentMeta(agent, conf),
            content: skipText,
            rawOutput: skipText,
            status: 'skipped',
            failed: true,
            error: memoryUnavailableReason,
            memoryStatus: agent.memoryEnabled ? 'chat-context-unavailable' : 'disabled',
          })));
        }

        lastPipelineRun = {
          version: RUN_LOG_VERSION,
          type,
          status: 'pre-skipped',
          reason: memoryUnavailableReason,
          characterId: runScope?.characterId || 'unknown-character',
          chatIndex: runScope?.chatIndex || '0',
          chatKey: runScope?.chatKey || '',
          chatKeyDisplay: runScope?.chatKeyDisplay || '',
          chatKeySource: runScope?.chatKeySource || '',
          chatScopeAvailable: runScope?.chatScopeAvailable !== false && Boolean(runScope?.chatKey),
          chatScopeError: runScope?.chatScopeError || '',
          characterName: runScope?.characterName || '(알 수 없는 캐릭터)',
          chatName: runScope?.chatName || '(알 수 없는 채팅방)',
          runKey: agentRunLogKey(runScope || {}),
          pipelineSnapshot: JSON.parse(JSON.stringify(pipeline)),
          settingBlocks: settingBlocks.content,
          settingBlockStats: settingBlocks.stats,
          preReuseVersion: PRE_REUSE_VERSION,
          preReuseKey,
          preReused: false,
          preReusedFrom: '',
          ...runChatContextMeta(chatContext),
          preResults,
          postResults: [],
          notes,
          userInput,
          timestamp: Date.now(),
          updatedAt: Date.now(),
        };

        return notes;
      }

      for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
        const agents = getEnabledAgentsForRow(pipeline, row);
        if (agents.length === 0) continue;

        const rowResults = await Promise.all(agents.map(async (agent) => {
          const agentConf = resolveAgentConfig(agent, conf);
          if (!agentConf.apiKey) {
            const content = `(실패: ${agentConf.provider} provider API key 없음)`;
            console.log(`Agents! pre-agent skipped (${agent.name}): ${agentConf.provider} provider API key not set`);
            return {
              ...runAgentMeta(agent, conf),
              content,
              rawOutput: content,
              status: 'skipped',
              failed: true,
              memoryStatus: agent.memoryEnabled ? 'skipped' : 'disabled',
            };
          }
          const history = formatHistory(contextMessages, agentConf.window);
          const agentMemory = memoryCanWrite
            ? await loadAgentMemory(agent, memoryScope, contextMessages, conf.debugLog)
            : await loadAgentMemoryReadOnly(agent, memoryScope, conf.debugLog, memoryUnavailableReason);
          const prompt = buildAgentPrompt(agent, {
            settingBlocks: settingBlocks.content,
            history,
            userInput,
            notes,
            agentMemory: agentMemory.value || EMPTY_AGENT_MEMORY,
          });

          if (conf.debugLog) logPromptFlow(`Agents! debug: Row ${row + 1} ${agent.name} prompt`, prompt, true);

          try {
            const content = await callAgent(agentConf, prompt);
            if (conf.debugLog) logTextBlock(`Agents! debug: Row ${row + 1} ${agent.name} result`, content);
            if (agentMemory.enabled) {
              const parsed = parseMemoryAgentOutput(content);
              if (parsed.ok) {
                let saved = false;
                let memoryStatus = 'empty-update';
                if (parsed.memoryUpdate) {
                  if (agentMemory.chatScopeUnavailable) {
                    memoryStatus = 'chat-scope-unavailable';
                  } else if (agentMemory.chatContextUnavailable) {
                    memoryStatus = 'chat-context-unavailable';
                  } else {
                    saved = await saveAgentMemory(agent, agentMemory, parsed.memoryUpdate, conf.debugLog);
                    memoryStatus = saved ? 'updated' : 'storage-failed';
                  }
                }
                return {
                  ...runAgentMeta(agent, conf),
                  content: parsed.note || content,
                  rawOutput: content,
                  status: 'success',
                  memoryPrevious: agentMemory.value || '',
                  memoryUpdate: parsed.memoryUpdate,
                  memoryStatus,
                  memoryUpdated: Boolean(parsed.memoryUpdate && saved),
                  memoryStateKey: '',
                  memoryMessageCount: agentMemory.currentState?.messageCount ?? 0,
                  memoryPointer: agentMemory.pointer,
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
                memoryStateKey: '',
                memoryMessageCount: agentMemory.currentState?.messageCount ?? 0,
                memoryPointer: agentMemory.pointer,
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
            console.log(`Agents! pre-agent failed (${agent.name}): ${err.message}`);
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
        chatKey: runScope?.chatKey || '',
        chatKeyDisplay: runScope?.chatKeyDisplay || '',
        chatKeySource: runScope?.chatKeySource || '',
        chatScopeAvailable: runScope?.chatScopeAvailable !== false && Boolean(runScope?.chatKey),
        chatScopeError: runScope?.chatScopeError || '',
        characterName: runScope?.characterName || '(알 수 없는 캐릭터)',
        chatName: runScope?.chatName || '(알 수 없는 채팅방)',
        runKey: agentRunLogKey(runScope || {}),
        pipelineSnapshot: JSON.parse(JSON.stringify(pipeline)),
        settingBlocks: settingBlocks.content,
        settingBlockStats: settingBlocks.stats,
        preReuseVersion: PRE_REUSE_VERSION,
        preReuseKey,
        preReused: false,
        preReusedFrom: '',
        ...runChatContextMeta({
          ...chatContext,
          messageCount: chatContext?.messageCount ?? contextMessages.length,
        }),
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
          console.log(`Agents! post-agent skipped (${agent.name}): ${agentConf.provider} provider API key not set`);
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

        if (conf.debugLog) logPromptFlow(`Agents! debug: Row ${row + 1} ${agent.name} post-agent prompt`, prompt, true);

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
            if (conf.debugLog) logTextBlock(`Agents! debug: Row ${row + 1} ${agent.name} post-agent result`, currentResponse);
          } else {
            console.log(`Agents! post-agent returned empty response (${agent.name}); keeping previous response`);
            postResults.push({
              ...runAgentMeta(agent, conf),
              status: 'empty',
              inputResponse: currentResponse,
              outputResponse: currentResponse,
              rawOutput: '',
            });
          }
        } catch (err) {
          console.log(`Agents! post-agent failed (${agent.name}): ${err.message}`);
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
        lastPipelineRun.status = lastPipelineRun.preReused ? 'pre-reused' : 'complete';
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
        '[Agents! 분석 컨텍스트]',
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
      await Promise.all(LEGACY_UI_IDS.map(id => unregisterKnownUIPart(id)));

      try {
        const setting = await Risuai.registerSetting('Agents! 설정', openLiteDashboard, menuIcon, 'none', SETTINGS_UI_ID);
        console.log('Agents! setting registered', setting?.id || setting || '');
      } catch (err) {
        console.log(`Agents! setting registration failed: ${err.message}`);
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
        console.log(`Agents! hamburger button registration failed: ${err.message}`);
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
        console.log(`Agents! chat menu button registration failed: ${err.message}`);
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
.wrap{max-width:1120px;margin:0 auto;padding:22px 16px 124px}
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
.detail-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:20;display:flex;align-items:center;justify-content:center;padding:18px}
.memory-modal{width:min(920px,100%);max-height:min(82vh,760px);overflow:auto;background:#15171c;border:1px solid #343a46;border-radius:8px;box-shadow:0 22px 70px rgba(0,0,0,.45)}
.memory-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid #2c313a;padding:14px 16px}.memory-modal-head h2{font-size:1rem;margin:0 0 4px}.memory-modal-body{padding:14px 16px 18px}
.memory-stack{display:grid;gap:10px}.memory-snapshot{border:1px solid #303640;background:#101218;border-radius:7px;padding:11px}.memory-snapshot.current{border-color:#5e91ee;background:#121a29}
.memory-snapshot-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}.memory-snapshot-title{font-size:.82rem;font-weight:730}.memory-snapshot-meta{font-size:.72rem;color:#9aa4b2}
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
        ${runLog?.chatKeyDisplay || runLog?.chatKey ? `<span class="badge neutral">채팅방 키: ${escHtml(runLog.chatKeyDisplay || formatChatKeyPreview(runLog.chatKey))}</span>` : ''}
        ${runLog?.chatScopeAvailable === false ? `<span class="badge err">채팅방 스코프 없음${runLog.chatScopeError ? `: ${escHtml(runLog.chatScopeError)}` : ''}</span>` : ''}
        ${runLog?.chatContextSource ? `<span class="badge ${runLog.chatContextAvailable ? 'ok' : 'err'}">대화 컨텍스트: ${escHtml(runLog.chatContextSource)} · ${escHtml(runLog.chatContextMessageCount ?? 0)}개</span>` : ''}
        ${runLog?.chatContextError ? `<span class="badge err">컨텍스트 오류: ${escHtml(runLog.chatContextError)}</span>` : ''}
        ${runLog?.preReused ? `<span class="badge ok">Pre-Agent 재사용됨</span>` : ''}
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
        const reused = result?.reused ? ' · 재사용됨' : '';
        return `<div class="agent-card${selected}${disabled} ${escHtml(statusClass)}" data-agent-id="${escHtml(agent.id)}">
          <div class="agent-name">${escHtml(agent.name)}</div>
          <div class="agent-meta">${escHtml(preset.name || preset.model || 'model preset')} · ${escHtml(status)}${escHtml(memory)}${escHtml(reused)}</div>
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
        root.querySelector('[data-memory-stack-agent-id]')?.addEventListener('click', async (event) => {
          const targetAgent = findAgentById(pipeline, event.currentTarget.getAttribute('data-memory-stack-agent-id'));
          if (targetAgent) await openMemoryStackModal(targetAgent, conf);
        });
      }
    }

    function runSummaryText(runLog) {
      if (!runLog || runLog.status === 'no-run') return '아직 이 채팅에서 실행된 Agents! 결과가 없습니다.';
      if (runLog.status === 'chat-scope-unavailable') return `채팅방 고유 스코프를 만들지 못했습니다: ${runLog.reason || 'chat id unavailable'}`;
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
        'pre-reused': '재사용됨',
      };
      return labels[status] || status || '성공';
    }

    function statusBadgeClass(status) {
      if (status === 'success' || status === 'updated' || status === 'reused' || status === 'pre-reused') return 'ok';
      if (status === 'failed' || status === 'skipped' || status === 'parse-failed' || status === 'storage-failed' || status === 'chat-context-unavailable' || status === 'chat-scope-unavailable') return 'err';
      return 'neutral';
    }

    function memoryStatusLabel(status) {
      const labels = {
        disabled: '비활성',
        updated: '갱신됨',
        'empty-update': '빈 갱신',
        'parse-failed': '파싱 실패',
        'storage-failed': '저장 실패',
        'chat-context-unavailable': '대화 컨텍스트 없음',
        'chat-scope-unavailable': '채팅방 스코프 없음',
        reused: '재사용됨',
        skipped: '스킵',
        failed: '실패',
      };
      return labels[status] || status || '';
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
        ${result?.reused ? '<span class="badge ok">재사용됨</span>' : ''}
        ${result?.memoryStatus && result.memoryStatus !== 'disabled' ? `<span class="badge ${statusBadgeClass(result.memoryStatus)}">기억: ${escHtml(memoryStatusLabel(result.memoryStatus))}</span>` : ''}
      </div>`;
      const memoryButton = memoryInspectorButtonHtml(agent);

      if (!result) {
        return `<h2>${escHtml(agent.name)}</h2>${meta}${memoryButton}<div class="empty">이 에이전트의 최근 실행 결과가 없습니다.</div>`;
      }

      if (agent.mode === 'post') {
        return `<h2>${escHtml(agent.name)}</h2>${meta}
          ${detailBlockHtml('입력 응답', result.inputResponse || '(입력 응답 없음)')}
          ${detailBlockHtml('수정 후 응답', result.outputResponse || '(수정 후 응답 없음)')}
          ${result.error ? detailBlockHtml('오류', result.error) : ''}`;
      }

      return `<h2>${escHtml(agent.name)}</h2>${meta}
        ${memoryButton}
        ${detailBlockHtml('생성된 Note', result.content || '(노트 없음)')}
        ${detailBlockHtml('Raw Output', result.rawOutput || result.content || '(원본 출력 없음)')}
        ${result.error ? detailBlockHtml('오류', result.error) : ''}`;
    }

    function memoryInspectorButtonHtml(agent) {
      if (!(agent.mode === 'pre' && agent.memoryEnabled)) return '';
      return `<div class="detail-actions"><button data-memory-stack-agent-id="${escHtml(agent.id)}">현재 채팅방 기억 보기</button></div>`;
    }

    async function openMemoryStackModal(agent, conf) {
      const scope = await getAgentMemoryScope(conf?.debugLog);
      const key = agentMemoryKey(agent, scope);
      let store = normalizeMemoryStore(null, agent, scope);
      let error = '';
      if (!key) {
        error = scope.chatScopeError || '채팅방 고유 스코프를 만들지 못했습니다.';
      } else {
        try {
          const raw = await Risuai.pluginStorage.getItem(key);
          store = normalizeMemoryStore(raw, agent, scope);
        } catch (err) {
          error = err.message || String(err);
        }
      }

      document.getElementById('memory-stack-modal')?.remove();
      document.body.insertAdjacentHTML('beforeend', memoryStackModalHtml(agent, store, scope, key, error));
      document.getElementById('memory-stack-close')?.addEventListener('click', closeMemoryStackModal);
      document.getElementById('memory-stack-modal')?.addEventListener('click', (event) => {
        if (event.target?.id === 'memory-stack-modal') closeMemoryStackModal();
      });
    }

    function closeMemoryStackModal() {
      document.getElementById('memory-stack-modal')?.remove();
    }

    function memoryStackModalHtml(agent, store, scope, key, error = '') {
      const list = (Array.isArray(store?.snapshots) ? store.snapshots : [])
        .slice()
        .sort((a, b) => (Number(a.messageCount) || 0) - (Number(b.messageCount) || 0))
        .map((snapshot, idx, snapshots) => ({
          snapshot,
          latest: idx === snapshots.length - 1,
        }));
      const content = error
        ? `<div class="empty">기억을 불러오지 못했습니다: ${escHtml(error)}</div>`
        : list.length
          ? `<div class="memory-stack">${list.map(item => memorySnapshotHtml(item.snapshot, item.latest)).join('')}</div>`
          : '<div class="empty">현재 채팅방에 저장된 기억이 없습니다.</div>';

      return `<div id="memory-stack-modal" class="modal-backdrop">
        <div class="memory-modal" role="dialog" aria-modal="true" aria-label="현재 채팅방 기억">
          <div class="memory-modal-head">
            <div>
              <h2>${escHtml(agent.name)} 기억</h2>
              <div class="metric-sub">캐릭터: ${escHtml(scope.characterName || '(알 수 없음)')} · 채팅방: ${escHtml(scope.chatName || '(알 수 없음)')}</div>
              <div class="metric-sub">채팅방 키: ${escHtml(scope.chatKeyDisplay || '(없음)')}${scope.chatKeySource ? ` · ${escHtml(scope.chatKeySource)}` : ''}</div>
              ${scope.chatScopeError ? `<div class="metric-sub">스코프 오류: ${escHtml(scope.chatScopeError)}</div>` : ''}
              <div class="metric-sub">storage key: ${escHtml(key ? formatChatKeyPreview(key) : '(없음)')}</div>
            </div>
            <button id="memory-stack-close" class="ghost">닫기</button>
          </div>
          <div class="memory-modal-body">${content}</div>
        </div>
      </div>`;
    }

    function memorySnapshotHtml(snapshot, isLatest) {
      const label = `대화 ${snapshot.messageCount ?? 0}개 시점`;
      const updatedAt = formatInspectorTime(snapshot.updatedAt);
      const usedAt = formatInspectorTime(snapshot.usedAt);
      return `<div class="memory-snapshot${isLatest ? ' current' : ''}">
        <div class="memory-snapshot-head">
          <div>
            <div class="memory-snapshot-title">${escHtml(label)}</div>
            <div class="memory-snapshot-meta">실제 대화 메시지 ${escHtml(snapshot.messageCount ?? 0)}개</div>
          </div>
          <div class="memory-snapshot-meta">사용 ${escHtml(usedAt)} · 갱신 ${escHtml(updatedAt)}</div>
        </div>
        ${snapshot.preview ? `<div class="metric-sub">스냅샷 기준 최근 대화: ${escHtml(snapshot.preview)}</div>` : ''}
        <div class="detail-block"><h3>기억 내용</h3><pre>${escHtml(snapshot.value || EMPTY_AGENT_MEMORY)}</pre></div>
      </div>`;
    }

    function formatInspectorTime(time) {
      const numeric = Number(time);
      return Number.isFinite(numeric) && numeric > 0 ? new Date(numeric).toLocaleString() : '시간 정보 없음';
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
.provider-key-status{display:flex;align-items:center;min-height:38px}
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.64);z-index:40;display:flex;align-items:center;justify-content:center;padding:18px}
.prompt-modal{width:min(920px,100%);max-height:88vh;overflow:auto;background:#191b20;border:1px solid #343944;border-radius:8px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.42)}
.prompt-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.prompt-preview-meta{font-size:.76rem;color:#9aa4b2;margin-top:3px;overflow-wrap:anywhere}
.prompt-preview-block{background:#0f1115;border:1px solid #303640;border-radius:7px;padding:10px;margin-top:10px}
.prompt-preview-block h3{font-size:.78rem;color:#cbd5e1;margin-bottom:7px}
.prompt-preview-block pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;color:#eef2f7}
.actions-inner{max-width:1120px;margin:0 auto;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
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
    </div>
  </div>

  <div id="msg" class="msg"></div>

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
    <h2>Provider API Keys</h2>
    <div id="provider-key-editor"></div>
  </div>

  <div class="card">
    <h2>공통 설정</h2>
    <div class="field">
      <label for="agents_debug_log">Debug Log</label>
      <select id="agents_debug_log">
        <option value="true" ${conf.debugLog ? 'selected' : ''}>켜짐 - 프롬프트 흐름을 콘솔에 출력</option>
        <option value="false" ${!conf.debugLog ? 'selected' : ''}>꺼짐</option>
      </select>
    </div>
  </div>

  <div id="test-results"></div>
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
      let selectedProviderKeyProvider = normalizeProviderValue(modelPresetsState[0]?.provider || initialConf.provider || DEFAULT_AGENT_PROVIDER);
      let pipelineState = normalizePipelineConfig(JSON.parse(JSON.stringify(initialPipeline)), modelPresetsState);
      let selectedAgentId = findFirstAgentId(pipelineState);

      setupProviderControls();
      setupCredentialFiles();
      setupEndpointExamples();
      renderPipeline();
      renderAgentEditor();
      renderPresetList();
      renderPresetEditor();
      renderProviderKeyEditor();

      document.getElementById('run-inspector-tab-btn')?.addEventListener('click', openRunInspector);
      document.getElementById('preset-add-btn')?.addEventListener('click', addModelPreset);
      document.getElementById('save-btn')?.addEventListener('click', async () => {
        try {
          const next = collectLiteConfig(initialConf, pipelineState, modelPresetsState, providerKeysState);
          await saveLiteConfig(next);
          providerKeysState = { ...(next.providerKeys || {}) };
          renderProviderKeyEditor();
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
        pipelineState = normalizePipelineConfig(pipelineState, modelPresetsState);
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
        pipelineState = normalizePipelineConfig(pipelineState, modelPresetsState);
        renderPipeline();
        renderAgentEditor();
      }

      function deleteAgent(agent) {
        const row = pipelineState.rows[agent.row];
        row.agents = row.agents.filter(item => item.id !== agent.id);
        selectedAgentId = findFirstAgentId(pipelineState);
        pipelineState = normalizePipelineConfig(pipelineState, modelPresetsState);
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
        if (!providerDefaults(preset.provider) && preset.provider !== 'custom') {
          preset.provider = 'custom';
        }
        const isCustomProvider = !providerDefaults(preset.provider);
        if (!isCustomProvider) {
          preset.baseUrl = providerDefaults(preset.provider).baseUrl;
        }
        const endpointField = isCustomProvider
          ? `<div class="field"><label for="preset_baseUrl">Endpoint Base URL</label><input id="preset_baseUrl" type="text" value="${escHtml(preset.baseUrl)}"></div>`
          : '';

        root.innerHTML = `
          <div class="field"><label for="preset_name">Preset Name</label><input id="preset_name" type="text" value="${escHtml(preset.name)}"></div>
          <div class="field"><label for="preset_provider">Provider</label>${presetProviderSelect('preset_provider', preset.provider)}</div>
          ${endpointField}
          <div class="field"><label for="preset_model_select">Model</label>${modelSelect('preset_model', preset.provider, preset.model)}</div>
          <div class="row2">
            <div class="field"><label for="preset_temperature">Temperature</label><input id="preset_temperature" type="number" value="${escHtml(preset.temperature)}"></div>
            <div class="field"><label for="preset_maxTokens">Max Tokens</label><input id="preset_maxTokens" type="number" value="${escHtml(preset.maxTokens)}" placeholder="비우면 provider 기본값"></div>
          </div>
          <div class="field"><label for="preset_contextWindow">Context Window</label><input id="preset_contextWindow" type="number" min="1" value="${escHtml(preset.contextWindow)}"></div>
          <div class="mini-actions">
            <button id="preset-test-btn">Preset test</button>
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
          if (defaults) preset.baseUrl = defaults.baseUrl;
          if (defaults && shouldReplaceModel(previousModel)) preset.model = defaults.model;
          renderPipeline();
          renderPresetList();
          renderPresetEditor();
          renderProviderKeyEditor();
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

        document.getElementById('preset-test-btn')?.addEventListener('click', testSelectedPreset);
        document.getElementById('preset-delete-btn')?.addEventListener('click', () => deleteModelPreset(preset));
      }

      function renderProviderKeyEditor() {
        const root = document.getElementById('provider-key-editor');
        if (!root) return;

        const provider = normalizeProviderValue(selectedProviderKeyProvider || DEFAULT_AGENT_PROVIDER);
        const hasKey = Boolean(providerKeysState[provider]);
        const status = hasKey
          ? '<span class="badge ok">저장됨</span>'
          : '<span class="badge neutral">미설정</span>';
        const secretField = isVertexProvider(provider)
          ? `<textarea id="provider_key_secret" data-masked-secret="${hasKey ? 'true' : 'false'}" placeholder="Vertex service account JSON">${hasKey ? MASKED_SECRET : ''}</textarea>
             <input id="provider_key_file" type="file" accept="application/json,.json">`
          : `<input id="provider_key_secret" data-masked-secret="${hasKey ? 'true' : 'false'}" type="${hasKey ? 'text' : 'password'}" value="${hasKey ? MASKED_SECRET : ''}" placeholder="API key" autocomplete="off">`;

        root.innerHTML = `
          <div class="row2">
            <div class="field"><label for="provider_key_provider">Provider</label>${providerKeyProviderSelect('provider_key_provider', provider)}</div>
            <div class="field"><label>저장 상태</label><div class="provider-key-status">${status}</div></div>
          </div>
          <div class="provider-key-row">
            <div class="field"><label for="provider_key_secret">${escHtml(provider)} API Key</label>${secretField}</div>
            <button id="provider-key-delete-btn" class="danger">키 삭제</button>
          </div>`;

        bindProviderKeyEditor(provider);
      }

      function bindProviderKeyEditor(provider) {
        document.getElementById('provider_key_provider')?.addEventListener('change', (event) => {
          selectedProviderKeyProvider = normalizeProviderValue(event.target.value || DEFAULT_AGENT_PROVIDER);
          renderProviderKeyEditor();
        });

        const secret = document.getElementById('provider_key_secret');
        secret?.addEventListener('focus', () => {
          if (secret.dataset.maskedSecret === 'true' && secret.value === MASKED_SECRET) {
            secret.value = '';
            secret.dataset.maskedSecret = 'false';
            if (secret.tagName === 'INPUT') secret.type = 'password';
          }
        });
        secret?.addEventListener('input', (event) => {
          const value = event.target.value;
          if (value && value !== MASKED_SECRET) providerKeysState[provider] = value;
        });

        document.getElementById('provider_key_file')?.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          providerKeysState[provider] = await file.text();
          showMsg('Vertex AI JSON credential을 불러왔습니다.', true);
          renderProviderKeyEditor();
        });

        document.getElementById('provider-key-delete-btn')?.addEventListener('click', () => {
          delete providerKeysState[provider];
          renderProviderKeyEditor();
        });
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
        renderProviderKeyEditor();
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
        renderProviderKeyEditor();
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
          showMsg('Preset test 성공', true);
          setTestResults(testResultHtml(conf, true, result.status, latency, '', result.url));
        } catch (err) {
          showMsg(`Preset test 실패: ${err.message}`, false);
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
      const options = providerOptions();
      const known = options.some(option => option.value === normalized);
      const selected = known ? normalized : 'custom';
      return `<select id="${id}">${options.map(option =>
        `<option value="${escHtml(option.value)}" ${option.value === selected ? 'selected' : ''}>${escHtml(option.label)}</option>`
      ).join('')}</select>`;
    }

    function providerKeyProviderSelect(id, value) {
      const normalized = normalizeProviderValue(value || DEFAULT_AGENT_PROVIDER);
      const options = providerOptions();
      const selected = options.some(option => option.value === normalized) ? normalized : DEFAULT_AGENT_PROVIDER;
      return `<select id="${id}">${options.map(option =>
        `<option value="${escHtml(option.value)}" ${option.value === selected ? 'selected' : ''}>${escHtml(option.label)}</option>`
      ).join('')}</select>`;
    }

    function collectLiteConfig(initialConf, pipeline, modelPresets, providerKeys) {
      const normalizedPresets = normalizeModelPresets(modelPresets, initialConf);
      const firstPreset = normalizedPresets[0] || defaultModelPreset(initialConf);
      const normalizedKeys = {};
      Object.keys(providerKeys || {}).forEach((key) => {
        const provider = normalizeProviderValue(key);
        const value = String(providerKeys[key] || '');
        if (provider && value && value !== MASKED_SECRET) normalizedKeys[provider] = value;
      });
      return {
        provider: firstPreset.provider,
        baseUrl: normalizeUrl(firstPreset.baseUrl || DEFAULT_AGENT_BASE_URL),
        apiKey: normalizedKeys[firstPreset.provider] || initialConf.configuredApiKey || '',
        model: firstPreset.model || DEFAULT_AGENT_MODEL,
        temperature: parseAgentFloat(firstPreset.temperature, 0.7),
        maxTokens: parseOptionalInt(firstPreset.maxTokens),
        window: Math.max(1, parseInt(firstPreset.contextWindow, 10) || 10),
        debugLog: parseBool(getInputValue('agents_debug_log'), true),
        pipeline: normalizePipelineConfig(pipeline, normalizedPresets),
        modelPresets: normalizedPresets,
        providerKeys: normalizedKeys,
      };
    }

    async function saveLiteConfig(conf) {
      await Risuai.setArgument('agents_provider', conf.provider);
      await Risuai.setArgument('agents_base_url', conf.baseUrl);
      await Risuai.setArgument('agents_api_key', '');
      await Risuai.setArgument('agents_model', conf.model);
      await Risuai.setArgument('agents_temperature', String(conf.temperature));
      await Risuai.setArgument('agents_max_tokens', conf.maxTokens === null ? '' : String(conf.maxTokens));
      await Risuai.setArgument('agents_context_window', String(conf.window));
      await Risuai.setArgument('agents_debug_log', String(conf.debugLog));
      await Risuai.setArgument('agents_pipeline_json', JSON.stringify(conf.pipeline));
      await Risuai.setArgument('agents_model_presets_json', JSON.stringify(conf.modelPresets));
      await Risuai.setArgument('agents_provider_keys_json', JSON.stringify(conf.providerKeys));
    }

    async function testLiteLlm() {
      const conf = {
        provider: getProviderValue('agents_provider', DEFAULT_AGENT_PROVIDER),
        baseUrl: normalizeUrl(getInputValue('agents_base_url') || DEFAULT_AGENT_BASE_URL),
        apiKey: getCredentialValue('agents_api_key') || (await Risuai.getArgument('agents_api_key')) || '',
        model: getInputValue('agents_model') || DEFAULT_AGENT_MODEL,
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
        showMsg('Preset test 성공', true);
        setTestResults(testResultHtml(conf, true, result.status, latency, '', result.url));
      } catch (err) {
        showMsg(`Preset test 실패: ${err.message}`, false);
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
          <h2>Preset test</h2>
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
      if (isVertexProvider(getProviderValue('agents_provider', DEFAULT_AGENT_PROVIDER))) {
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
          const credential = document.querySelector('[data-credential="agents_api_key"]');
          credential?.classList.toggle('credential-vertex-active', select.value === 'vertex-ai');
          applyProviderDefaults(select.value);
          updateEndpointExample('agents_base_url');
        };
        select.addEventListener('change', update);
        update();
      });
    }

    function applyProviderDefaults(provider) {
      if (!provider || provider === 'custom') return;
      const defaults = providerDefaults(provider);
      if (!defaults) return;

      const baseInput = document.getElementById('agents_base_url');
      const modelInput = document.getElementById('agents_model');
      if (baseInput && shouldReplaceEndpoint(baseInput.value)) {
        baseInput.value = defaults.baseUrl;
        updateEndpointExample('agents_base_url');
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
        provider: getProviderValue('agents_provider', DEFAULT_AGENT_PROVIDER),
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
      console.log(`Agents! fetch: ${label}`, info);
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
      if (console.groupCollapsed) console.groupCollapsed('Agents! debug: setting block stats');
      else console.log('Agents! debug: setting block stats');
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
        const chatContext = await loadActualChatContext(messages, conf.debugLog);
        const settingBlocks = await buildSettingBlocks(messages);
        const preReuseKey = buildPreReuseKey(runScope, chatContext, settingBlocks, pipeline, conf);
        const previousRun = await loadRunLogForScope(runScope, conf.debugLog);
        const reusableRun = findReusablePreRun(previousRun, preReuseKey);

        if (reusableRun) {
          lastPipelineRun = createPreReusedRunLog(type, pipeline, conf, runScope, chatContext, settingBlocks, reusableRun, preReuseKey);
          const injectedMessages = injectAgentNotes(messages, lastPipelineRun.notes);
          await persistRunLog(lastPipelineRun, conf.debugLog);
          if (conf.debugLog) {
            console.log(`Agents! debug: pre-agent results reused from ${lastPipelineRun.preReusedFrom || '(unknown time)'}`);
            logPromptFlow('Agents! debug: messages sent to main LLM after pre-agent reuse', injectedMessages, true);
          }
          return injectedMessages;
        }

        if (!hasUsableProviderKeyForRows(pipeline, conf, 0, MAIN_ROW_INDEX - 1)) {
          console.log('Agents!: provider API key not set — pre-agent pipeline skipped');
          lastPipelineRun = createRunLogBase(type, pipeline, conf, runScope, 'skipped', 'pre-agent provider API key not set');
          lastPipelineRun.userInput = getUserInput(chatContext.messages);
          lastPipelineRun.settingBlocks = settingBlocks.content;
          lastPipelineRun.settingBlockStats = settingBlocks.stats;
          lastPipelineRun.preReuseKey = preReuseKey;
          lastPipelineRun.preReused = false;
          Object.assign(lastPipelineRun, runChatContextMeta(chatContext));
          await persistRunLog(lastPipelineRun, conf.debugLog);
          return messages;
        }

        if (conf.debugLog) {
          console.log('Agents! debug: beforeRequest type =', type);
          logPromptFlow('Agents! debug: RisuAI original messages', messages, true);
          console.log(`Agents! debug: chat context source = ${chatContext.source}; available = ${chatContext.available}; messages = ${chatContext.messageCount}`);
          if (chatContext.error) console.log(`Agents! debug: chat context error = ${chatContext.error}`);
          logPromptFlow('Agents! debug: messages used by Agents! context', chatContext.messages, true);
          logTextBlock('Agents! debug: setting blocks passed to agents', settingBlocks.content);
          logSettingBlockStats(settingBlocks.stats);
          logTextBlock('Agents! debug: current user input passed to agents', getUserInput(chatContext.messages));
        }

        const notes = await runPrePipeline(messages, chatContext, conf, pipeline, settingBlocks, type, runScope, preReuseKey);
        const injectedMessages = injectAgentNotes(messages, notes);
        await persistRunLog(lastPipelineRun, conf.debugLog);
        if (conf.debugLog) logPromptFlow('Agents! debug: messages sent to main LLM after injection', injectedMessages, true);
        return injectedMessages;

      } catch (err) {
        // 에러 시 원본 메시지 그대로 통과 (파이프라인 실패가 채팅을 막지 않도록)
        console.log(`Agents! pipeline error: ${err.message}`);
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
            if (lastPipelineRun.status !== 'skipped' && lastPipelineRun.status !== 'pre-skipped' && lastPipelineRun.status !== 'pre-reused') lastPipelineRun.status = 'complete';
            lastPipelineRun.finalResponse = String(content ?? '');
            await persistRunLog(lastPipelineRun, conf.debugLog);
          }
          return content;
        }

        if (!hasUsableProviderKeyForRows(pipeline, conf, MAIN_ROW_INDEX + 1, PIPELINE_ROW_COUNT - 1)) {
          console.log('Agents!: provider API key not set — post-agent pipeline skipped');
          if (lastPipelineRun) {
            lastPipelineRun.status = 'post-skipped';
            lastPipelineRun.reason = 'post-agent provider API key not set';
            lastPipelineRun.finalResponse = String(content ?? '');
            await persistRunLog(lastPipelineRun, conf.debugLog);
          }
          return content;
        }

        if (conf.debugLog) {
          console.log('Agents! debug: afterRequest type =', type);
          logTextBlock('Agents! debug: main model response before post-agents', content);
        }

        const finalContent = await runPostPipeline(content, conf, pipeline, type);
        await persistRunLog(lastPipelineRun, conf.debugLog);
        if (conf.debugLog) logTextBlock('Agents! debug: final response after post-agents', finalContent);
        return finalContent;
      } catch (err) {
        console.log(`Agents! afterRequest pipeline error: ${err.message}`);
        return content;
      }
    });

    console.log('Agents! v1.0.0 loaded');

  } catch (err) {
    console.log(`Agents! init error: ${err.message}`);
  }
})();
