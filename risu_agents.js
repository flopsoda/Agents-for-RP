//@name risu_agents
//@display-name Agents!
//@api 3.0
//@version 1.1.10
//@update-url https://raw.githubusercontent.com/flopsoda/Agents-for-RP/main/risu_agents.js
//@arg agents_provider string Analysis agent provider label. e.g. openai
//@arg agents_base_url string Analysis agent API base URL. e.g. https://api.openai.com/v1, https://api.anthropic.com/v1, https://api.deepseek.com, https://ollama.com/v1, or Vertex AI OpenAI-compatible endpoint
//@arg agents_api_key string Analysis agent API key
//@arg agents_model string Analysis agent model. e.g. gpt-4o-mini
//@arg agents_temperature string Analysis agent temperature (default: 0.7)
//@arg agents_max_tokens string Analysis agent max tokens (blank = provider default)
//@arg agents_context_window int Recent messages per agent (default: 10)
//@arg agents_debug_log string Print Agents! prompt flow to console. true/false (default: false)
//@arg agents_run_log_enabled string Store Agents! run logs for Run Inspector. true/false (default: false)
//@arg agents_bypass_aux_requests string Skip Agents! for auxiliary RisuAI requests. true/false (default: true)
//@arg agents_extra_body_json string Extra JSON body merged into agent API requests
//@arg agents_proxy_url string Optional CORS proxy URL for agent requests
//@arg agents_proxy_key string Optional CORS proxy access token
//@arg agents_proxy_direct string Use direct proxy mode with X-Target-URL. true/false (default: false)
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
    const DEFAULT_AGENT_PROVIDER = 'openai';
    const DEFAULT_AGENT_BASE_URL = 'https://api.openai.com/v1';
    const DEFAULT_AGENT_MODEL = 'gpt-4o-mini';
    const MASKED_SECRET = '*****';
    const DEFAULT_OPENAI_PRESET_ID = 'preset-default-openai';
    const DEFAULT_OLLAMA_GEMINI_PRESET_ID = 'preset-default-ollama-gemini-3-flash';
    const DEFAULT_OLLAMA_DEEPSEEK_PRESET_ID = 'preset-default-ollama-deepseek-v4-flash';
    const DEFAULT_MODEL_PRESET_ID = DEFAULT_OPENAI_PRESET_ID;
    const UNSET_MODEL_PRESET_ID = '';
    const MODEL_PRESET_UNSET_LABEL = '모델 프리셋 설정하지 않음';
    const PIPELINE_PRESETS_STORAGE_KEY = 'risu_agents_pipeline_presets_v1';
    const PIPELINE_PRESET_STORE_VERSION = 1;
    const AGENT_EXPORT_KIND = 'risu-agents.agent-preset';
    const PIPELINE_EXPORT_KIND = 'risu-agents.pipeline-preset';
    const DEFAULT_PROVIDER_ORDER = ['openai', 'google', 'claude', 'vertex-ai', 'deepseek', 'ollama'];
    const EMPTY_AGENT_MEMORY = '(저장된 기억 없음)';
    const MEMORY_NOTE_TAG = 'AGENT_NOTE';
    const MEMORY_UPDATE_TAG = 'MEMORY_UPDATE';
    const MEMORY_STACK_VERSION = 4;
    const RUN_LOG_VERSION = 1;
    const RUN_LOG_BODY_VERSION = 1;
    const RUN_LOG_BODY_INLINE_LIMIT = 1000;
    const RUN_LOG_BODY_PREVIEW_CHARS = 700;
    const PRE_REUSE_VERSION = 3;
    const PLUGIN_CHAT_ID_FIELD = 'risuAgentsChatId';
    const AGENT_CBS_MAX_PASSES = 32;
    const AGENT_CBS_MAX_BLOCKS = 128;
    const AGENT_CBS_MAX_WARNINGS = 40;
    const AGENT_CBS_LITERAL_PREFIX = '\u0000AGENT_CBS_LITERAL_';
    const AGENT_CBS_LITERAL_SUFFIX = '_END\u0000';
    const SETTINGS_UI_ID = 'risu-agents-settings';
    const HAMBURGER_UI_ID = 'risu-agents-hamburger';
    const CHAT_UI_ID = 'risu-agents-chat';
    const AGENT_LLM_TIMEOUT_MS = 120000;
    const LEGACY_UI_IDS = ['risu-multiagent-lite-hamburger', 'risu-multiagent-lite-chat'];
    const MODEL_SEED_CATALOG = {
      ollama: [
        'gemini-3-flash-preview:cloud',
        'deepseek-v4-pro:cloud',
        'deepseek-v4-flash:cloud',
        'kimi-k2.6:cloud',
        'gemma4:31b-cloud',
        'qwen3.5:cloud',
        'qwen3.5:397b-cloud',
        'glm-5.1:cloud',
        'minimax-m2.7:cloud',
        'nemotron-3-super:cloud',
        'glm-5:cloud',
        'minimax-m2.5:cloud',
        'qwen3-coder-next:cloud',
        'deepseek-v3.2:cloud',
      ],
      openai: [
        'gpt-4o-mini',
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gpt-5.2',
        'gpt-5.2-pro',
        'gpt-5.1',
        'gpt-5',
        'gpt-5-pro',
        'gpt-5-mini',
        'gpt-5-nano',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
      ],
      deepseek: [
        'deepseek-v4-flash',
        'deepseek-v4-pro',
      ],
      claude: [
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5-20251001',
        'claude-opus-4-1-20250805',
        'claude-opus-4-20250514',
        'claude-sonnet-4-20250514',
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
      ],
      google: [
        'gemini-3.1-pro-preview',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite',
        'gemini-3.1-flash-lite-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash-lite-preview-09-2025',
      ],
      'vertex-ai': [
        'google/gemini-3.1-pro-preview',
        'google/gemini-3-flash-preview',
        'google/gemini-3.1-flash-lite',
        'google/gemini-3.1-flash-lite-preview',
        'google/gemini-2.5-pro',
        'google/gemini-2.5-flash',
        'google/gemini-2.5-flash-lite',
        'google/gemini-2.5-flash-lite-preview-09-2025',
      ],
    };
    const PIPELINE_ROW_COUNT = 9;
    const MAIN_ROW_INDEX = 4;
    const AGENTS_CONFIG_VAULT_KEY = 'risu_agents_config_vault_v1';
    const AGENTS_CONFIG_VAULT_VERSION = 1;
    let lastPipelineRun = null;

    // ── 설정 로드 ─────────────────────────────────────────────────────────────

    async function getConfig() {
      const vault = await loadConfigVault();
      const provider = String(preferArgumentValue(await Risuai.getArgument('agents_provider'), vault.provider || DEFAULT_AGENT_PROVIDER));
      const baseUrl = normalizeUrl(preferArgumentValue(await Risuai.getArgument('agents_base_url'), vault.baseUrl || DEFAULT_AGENT_BASE_URL));
      const configuredApiKey  = String(preferArgumentValue(await Risuai.getArgument('agents_api_key'), vault.configuredApiKey || vault.apiKey || ''));
      const model   = String(preferArgumentValue(await Risuai.getArgument('agents_model'), vault.model || DEFAULT_AGENT_MODEL));
      const temperature = parseFloat(String(preferArgumentValue(await Risuai.getArgument('agents_temperature'), vault.temperature ?? '0.7')));
      const maxTokens = parseOptionalInt(preferArgumentValue(await Risuai.getArgument('agents_max_tokens'), vault.maxTokens ?? ''));
      const window  = Math.max(1, parseInt(preferArgumentValue(await Risuai.getArgument('agents_context_window'), vault.window || '10')) || 10);
      const debugLog = parseBool(preferArgumentValue(await Risuai.getArgument('agents_debug_log'), vault.debugLog ?? false), false);
      const runLogEnabled = parseBool(preferArgumentValue(await Risuai.getArgument('agents_run_log_enabled'), vault.runLogEnabled ?? false), false);
      const bypassAuxRequests = parseBool(preferArgumentValue(await Risuai.getArgument('agents_bypass_aux_requests'), vault.bypassAuxRequests ?? true), true);
      const extraBodyJson = String(preferArgumentValue(await Risuai.getArgument('agents_extra_body_json'), vault.extraBodyJson || '')).trim();
      const proxyUrl = normalizeProxyUrl(preferArgumentValue(await Risuai.getArgument('agents_proxy_url'), vault.proxyUrl || ''));
      const proxyKey = String(preferArgumentValue(await Risuai.getArgument('agents_proxy_key'), vault.proxyKey || '')).trim();
      const proxyDirect = parseBool(preferArgumentValue(await Risuai.getArgument('agents_proxy_direct'), vault.proxyDirect ?? false), false);
      const fallbackConfig = {
        provider,
        baseUrl,
        model,
        temperature: Number.isFinite(temperature) ? temperature : 0.7,
        maxTokens,
        window,
      };
      const providerKeysRaw = preferArgumentValue(
        await Risuai.getArgument('agents_provider_keys_json'),
        vault.providerKeys ? JSON.stringify(vault.providerKeys) : '',
      );
      const modelPresetsRaw = preferArgumentValue(
        await Risuai.getArgument('agents_model_presets_json'),
        vault.modelPresets ? JSON.stringify(vault.modelPresets) : '',
      );
      const pipelineRaw = await Risuai.getArgument('agents_pipeline_json');
      const providerKeys = parseProviderKeys(
        providerKeysRaw,
        provider,
        configuredApiKey,
        debugLog,
      );
      const modelPresets = parseModelPresets(
        modelPresetsRaw,
        fallbackConfig,
        debugLog,
      );
      let pipeline = vault.pipeline || null;
      if (!pipeline && pipelineRaw) {
        try {
          pipeline = normalizePipelineConfig(JSON.parse(String(pipelineRaw)), modelPresets);
        } catch (err) {
          if (debugLog) console.log(`Agents! config vault pipeline fallback parse failed: ${err.message}`);
        }
      }
      const apiKey = getProviderApiKey(providerKeys, provider) || configuredApiKey;
      const config = {
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
        runLogEnabled,
        bypassAuxRequests,
        extraBodyJson,
        proxyUrl,
        proxyKey,
        proxyDirect,
        pipeline,
        pipelinePresetStore: vault.pipelinePresetStore || null,
      };
      if (!vault.exists) await saveConfigVault(config, debugLog);
      return config;
    }

    function preferArgumentValue(argValue, fallbackValue) {
      if (argValue === undefined || argValue === null || String(argValue) === '') return fallbackValue;
      return argValue;
    }

    async function loadConfigVault(debugLog = false) {
      try {
        const raw = await Risuai.pluginStorage.getItem(AGENTS_CONFIG_VAULT_KEY);
        const vault = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!vault || vault.version !== AGENTS_CONFIG_VAULT_VERSION) return { exists: false };
        return { exists: true, ...normalizeConfigVault(vault.config || {}) };
      } catch (err) {
        if (debugLog) console.log(`Agents! config vault load failed: ${err.message}`);
        return { exists: false };
      }
    }

    async function saveConfigVault(conf, debugLog = false) {
      try {
        await Risuai.pluginStorage.setItem(AGENTS_CONFIG_VAULT_KEY, {
          version: AGENTS_CONFIG_VAULT_VERSION,
          savedAt: new Date().toISOString(),
          config: normalizeConfigVault(conf),
        });
      } catch (err) {
        if (debugLog) console.log(`Agents! config vault save failed: ${err.message}`);
      }
    }

    function normalizeConfigVault(conf) {
      const provider = String(conf?.provider || DEFAULT_AGENT_PROVIDER);
      const baseUrl = normalizeUrl(conf?.baseUrl || DEFAULT_AGENT_BASE_URL);
      const temperature = Number.isFinite(Number(conf?.temperature)) ? Number(conf.temperature) : 0.7;
      const maxTokens = conf?.maxTokens === null || conf?.maxTokens === undefined || conf?.maxTokens === ''
        ? null
        : parseOptionalInt(conf.maxTokens);
      const window = Math.max(1, parseInt(conf?.window || '10') || 10);
      const fallbackConfig = {
        provider,
        baseUrl,
        model: String(conf?.model || DEFAULT_AGENT_MODEL),
        temperature,
        maxTokens,
        window,
      };
      const providerKeys = parseProviderKeys(
        conf?.providerKeys ? JSON.stringify(conf.providerKeys) : '',
        provider,
        conf?.configuredApiKey || conf?.apiKey || '',
        conf?.debugLog === true,
      );
      const modelPresets = normalizeModelPresets(conf?.modelPresets || [], fallbackConfig);
      const pipelinePresetStore = conf?.pipelinePresetStore
        ? normalizePipelinePresetStore(conf.pipelinePresetStore, conf?.pipeline, modelPresets)
        : null;
      const activePipeline = pipelinePresetStore
        ? getActivePipelinePreset(pipelinePresetStore)?.pipeline
        : conf?.pipeline;

      return {
        provider,
        baseUrl,
        apiKey: String(conf?.apiKey || getProviderApiKey(providerKeys, provider) || ''),
        configuredApiKey: String(conf?.configuredApiKey || ''),
        model: fallbackConfig.model,
        temperature,
        maxTokens,
        window,
        debugLog: conf?.debugLog === true,
        runLogEnabled: conf?.runLogEnabled === true,
        bypassAuxRequests: conf?.bypassAuxRequests !== false,
        extraBodyJson: normalizeExtraBodyJson(conf?.extraBodyJson || ''),
        proxyUrl: normalizeProxyUrl(conf?.proxyUrl || ''),
        proxyKey: String(conf?.proxyKey || ''),
        proxyDirect: conf?.proxyDirect === true,
        modelPresets,
        providerKeys,
        pipeline: activePipeline ? normalizePipelineConfig(activePipeline, modelPresets) : null,
        pipelinePresetStore,
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

    function buildChatCompletionPayload(conf, messages) {
      const payload = {
        model: conf.model,
        messages,
        temperature: conf.temperature,
      };
      if (conf.maxTokens !== null) payload.max_tokens = conf.maxTokens;

      return applyRequestBodyOverrides(payload, conf);
    }

    function applyRequestBodyOverrides(payload, conf) {
      let result = payload;
      const globalExtraBody = parseExtraBodyJsonRuntime(conf.extraBodyJson, conf.debugLog, 'global extra JSON body');
      if (globalExtraBody) result = deepMergeJson(result, globalExtraBody);
      const presetExtraBody = parseExtraBodyJsonRuntime(conf.presetExtraBodyJson, conf.debugLog, 'preset extra JSON body');
      if (presetExtraBody) result = deepMergeJson(result, presetExtraBody);
      return applyReasoningQuickSetting(result, conf);
    }

    function parseExtraBodyJsonRuntime(raw, debugLog, label = 'extra JSON body') {
      try {
        return parseExtraBodyJson(raw);
      } catch (err) {
        if (debugLog) console.log(`Agents! ${label} ignored: ${err.message}`);
        return null;
      }
    }

    function applyReasoningQuickSetting(payload, conf) {
      const setting = normalizeReasoningQuickSetting(conf?.provider, conf?.reasoningQuickSetting);
      if (setting === 'default') return payload;

      const result = { ...payload };
      if (isDeepSeekProvider(conf?.provider)) {
        result.thinking = {
          ...(isPlainObject(result.thinking) ? result.thinking : {}),
          type: setting === 'disabled' ? 'disabled' : 'enabled',
        };
        if (setting === 'disabled') {
          delete result.reasoning_effort;
          delete result.reasoning;
        } else {
          result.reasoning_effort = setting;
        }
        return result;
      }

      if (isAnthropicProvider(conf?.provider)) {
        result.output_config = {
          ...(isPlainObject(result.output_config) ? result.output_config : {}),
          effort: setting,
        };
        return result;
      }

      if (isOpenAIProvider(conf?.provider) || isGoogleProvider(conf?.provider) || isVertexProvider(conf?.provider) || isOllamaProvider(conf?.provider)) {
        result.reasoning_effort = setting;
      }
      return result;
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
          const presets = normalizeModelPresets(source, fallbackConfig, { debugLog });
          if (presets.length > 0) return presets;
        } catch (err) {
          if (debugLog) console.log(`Agents! model preset JSON parse failed: ${err.message}`);
        }
      }
      return defaultModelPresets(fallbackConfig);
    }

    function normalizeModelPresets(source, fallbackConfig, options = {}) {
      const used = new Set();
      const presets = (Array.isArray(source) ? source : [])
        .map((preset, idx) => normalizeModelPreset(preset, fallbackConfig, idx, used, options))
        .filter(Boolean);
      return ensureDefaultProviderPresets(presets, fallbackConfig, used);
    }

    function normalizeModelPreset(preset, fallbackConfig, idx, used, options = {}) {
      const fallback = fallbackConfig || {};
      const baseId = String(preset?.id || (idx === 0 ? DEFAULT_MODEL_PRESET_ID : makeAgentId('preset')));
      let id = baseId;
      while (used.has(id)) id = `${baseId}-${used.size + 1}`;
      used.add(id);

      const provider = normalizeProviderValue(preset?.provider || fallback.provider || DEFAULT_AGENT_PROVIDER);
      const defaults = providerDefaults(provider);
      return {
        id,
        name: String(preset?.name || (idx === 0 ? defaultPresetName(provider) : `Model Preset ${idx + 1}`)),
        provider,
        baseUrl: normalizeUrl(preset?.baseUrl || fallback.baseUrl || defaults?.baseUrl || DEFAULT_AGENT_BASE_URL),
        model: String(preset?.model || fallback.model || DEFAULT_AGENT_MODEL),
        temperature: preset?.temperature === null || preset?.temperature === undefined || preset?.temperature === ''
          ? String(fallback.temperature ?? 0.7)
          : String(preset.temperature),
        maxTokens: preset?.maxTokens === null || preset?.maxTokens === undefined ? '' : String(preset.maxTokens),
        contextWindow: preset?.contextWindow === null || preset?.contextWindow === undefined || preset?.contextWindow === ''
          ? String(fallback.window || 10)
          : String(preset.contextWindow),
        reasoningQuickSetting: normalizeReasoningQuickSetting(provider, preset?.reasoningQuickSetting),
        extraBodyJson: normalizePresetExtraBodyJson(preset?.extraBodyJson, options),
      };
    }

    function defaultModelPreset(fallbackConfig) {
      return defaultModelPresets(fallbackConfig)[0];
    }

    function defaultModelPresets(fallbackConfig) {
      const presets = [
        defaultModelPresetForProvider(DEFAULT_AGENT_PROVIDER, fallbackConfig),
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
        .filter(provider => provider !== DEFAULT_AGENT_PROVIDER && provider !== 'ollama')
        .forEach((provider, idx) => presets.push(defaultModelPresetForProvider(provider, fallbackConfig, idx)));
      return presets;
    }

    function defaultOllamaModelPreset(id, name, model, fallbackConfig) {
      return {
        id,
        name,
        provider: 'ollama',
        baseUrl: normalizeUrl(providerDefaults('ollama')?.baseUrl || 'https://ollama.com/v1'),
        model,
        temperature: String(fallbackConfig?.temperature ?? 0.7),
        maxTokens: fallbackConfig?.maxTokens === null || fallbackConfig?.maxTokens === undefined ? '' : String(fallbackConfig.maxTokens),
        contextWindow: String(fallbackConfig?.window || 10),
        reasoningQuickSetting: 'default',
        extraBodyJson: '',
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
        reasoningQuickSetting: 'default',
        extraBodyJson: '',
      };
    }

    function ensureDefaultProviderPresets(presets, fallbackConfig, used = null) {
      const result = Array.isArray(presets) ? presets.slice() : [];
      const idSet = used || new Set(result.map(preset => preset.id));
      const existingProviders = new Set(result.map(preset => normalizeProviderValue(preset.provider)));

      [
        defaultModelPresetForProvider(DEFAULT_AGENT_PROVIDER, fallbackConfig),
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
        existingProviders.add(normalizeProviderValue(preset.provider));
      });

      DEFAULT_PROVIDER_ORDER.filter(provider => provider !== DEFAULT_AGENT_PROVIDER).forEach((provider, idx) => {
        if (existingProviders.has(provider)) return;
        const preset = defaultModelPresetForProvider(provider, fallbackConfig, idx);
        let id = preset.id;
        while (idSet.has(id)) id = `${preset.id}-${idSet.size + 1}`;
        preset.id = id;
        idSet.add(id);
        existingProviders.add(normalizeProviderValue(preset.provider));
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
        deepseek: 'DeepSeek',
      };
      return names[normalizeProviderValue(provider)] || 'Model Preset';
    }

    function getProviderApiKey(providerKeys, provider) {
      const normalized = normalizeProviderValue(provider || DEFAULT_AGENT_PROVIDER);
      return String(providerKeys?.[normalized] || '');
    }

    function findModelPreset(presets, id) {
      const list = Array.isArray(presets) ? presets : [];
      if (!id) return null;
      return list.find(preset => preset.id === id) || null;
    }

    async function callOpenAICompatibleAgent(conf, messages) {
      const payload = buildChatCompletionPayload(conf, messages);

      const url = `${conf.baseUrl}/chat/completions`;
      logAgentFetch(conf, 'OpenAI-compatible chat/completions start', url, payload);
      const res = await nativeFetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${conf.apiKey}`,
        },
        body: JSON.stringify(payload),
      }, 'OpenAI-compatible chat/completions', conf);
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
      let payload = {
        model: conf.model,
        messages: anthropicMessages,
        temperature: conf.temperature,
        max_tokens: conf.maxTokens || 1024,
      };
      if (system) payload.system = system;
      payload = applyRequestBodyOverrides(payload, conf);

      const url = `${conf.baseUrl}/messages`;
      logAgentFetch(conf, 'Anthropic messages start', url, payload);
      const res = await nativeFetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': conf.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      }, 'Anthropic messages', conf);
      logAgentFetch(conf, `Anthropic messages response ${res.status}`, url);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return extractAnthropicText(data);
    }

    async function callVertexAgent(conf, messages) {
      const vertexCredential = parseVertexCredential(conf.apiKey);
      const baseUrl = resolveVertexBaseUrl(conf.baseUrl, vertexCredential);
      const accessToken = await getVertexAccessToken(conf.apiKey);
      const payload = buildChatCompletionPayload(conf, messages);

      const url = `${baseUrl}/chat/completions`;
      logAgentFetch(conf, 'Vertex chat/completions start', url, payload);
      const res = await nativeFetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      }, 'Vertex chat/completions', conf);
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

    async function buildPipelineRunContext(requestMessages, chatContext, conf, pipeline) {
      const sources = await loadSettingSources(conf?.debugLog);
      const contextMessages = chatContext?.available === true && Array.isArray(chatContext?.messages)
        ? chatContext.messages
        : normalizeRequestMessages(requestMessages);
      const maxWindow = Math.max(1, maxPreAgentContextWindow(pipeline, conf) || conf?.window || 10);
      const currentChatContext = await loadCurrentChatForSettings(sources.character, conf?.debugLog);
      const loreCandidates = collectLorebookCandidates(sources.character, sources.db, currentChatContext);
      const loreMatch = matchActiveLorebooksLikeRisu(contextMessages, loreCandidates, {
        scanWindow: maxWindow,
        fullWordMatching: sources.character?.loreSettings?.fullWordMatching === true,
        recursiveScanning: sources.character?.loreSettings?.recursiveScanning !== false,
      });
      const settingBlocks = await buildSettingBlocks(requestMessages, {
        character: sources.character,
        db: sources.db,
        dbAvailable: sources.dbAvailable,
        currentChatContext,
        activeLorebooks: loreMatch.activeLorebooks,
        loreCandidates,
        loreStats: loreMatch.stats,
      });
      const cbsContext = buildAgentCbsContext({
        character: sources.character,
        db: sources.db,
        currentChatContext,
        chatContext,
      });
      const globalNoteReplacement = String(sources.character?.replaceGlobalNote || '').trim();
      const historyCache = new Map();
      return {
        ...sources,
        contextMessages,
        maxWindow,
        loreCandidates,
        activeLorebooks: loreMatch.activeLorebooks,
        loreStats: loreMatch.stats,
        settingBlocks,
        globalNoteReplacement,
        cbsContext,
        currentChatContext,
        historyForWindow(windowSize) {
          const key = Math.max(1, parseInt(windowSize, 10) || maxWindow);
          if (!historyCache.has(key)) {
            historyCache.set(key, formatHistory(contextMessages, key));
          }
          return historyCache.get(key);
        },
      };
    }

    async function loadSettingSources(debugLog) {
      let character = null;
      let db = null;
      let dbAvailable = false;

      try {
        character = await Risuai.getCharacter();
      } catch (err) {
        console.log(`Agents! setting blocks: getCharacter failed: ${err.message}`);
      }

      try {
        db = await Risuai.getDatabase([
          'personas',
          'selectedPersona',
          'modules',
          'enabledModules',
          'globalChatVariables',
        ]);
        dbAvailable = Boolean(db);
      } catch (err) {
        console.log(`Agents! setting blocks: getDatabase failed: ${err.message}`);
      }

      if (debugLog && !dbAvailable) {
        console.log('Agents! lorebook matcher: database unavailable; module lorebooks skipped');
      }

      return { character, db, dbAvailable };
    }

    async function loadCurrentChatForSettings(character, debugLog) {
      const fallbackChat = getCurrentCharacterChat(character);
      const fallback = {
        chat: fallbackChat,
        characterIndex: null,
        chatIndex: Number.isInteger(character?.chatPage) ? character.chatPage : null,
        source: fallbackChat ? 'fallback' : 'missing',
        error: '',
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
        const error = errors.join('; ') || 'current character/chat index unavailable';
        if (debugLog) console.log(`Agents! setting blocks: current chat fallback used (${error})`);
        return { ...fallback, error };
      }

      try {
        const chat = await Risuai.getChatFromIndex(parseInt(characterIndex, 10), parseInt(chatIndex, 10));
        if (chat) {
          return {
            chat,
            characterIndex: parseInt(characterIndex, 10),
            chatIndex: parseInt(chatIndex, 10),
            source: 'getChatFromIndex',
            error: '',
          };
        }
        const error = 'getChatFromIndex: current chat object not found';
        if (debugLog) console.log(`Agents! setting blocks: current chat fallback used (${error})`);
        return { ...fallback, characterIndex, chatIndex, error };
      } catch (err) {
        const error = `getChatFromIndex: ${err.message}`;
        if (debugLog) console.log(`Agents! setting blocks: current chat fallback used (${error})`);
        return { ...fallback, characterIndex, chatIndex, error };
      }
    }

    async function buildSettingBlocks(messages, options = {}) {
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
        authorNoteSource: 'missing',
        chatLoreSource: options.currentChatContext?.source || 'missing',
        currentChatError: options.currentChatContext?.error || '',
        loreCandidates: 0,
        activeLorebooks: 0,
      };

      let character = options.character || null;
      let db = options.db || null;
      let dbAvailable = options.dbAvailable === true || Boolean(db);
      const currentChatContext = options.currentChatContext || null;

      if (!character && !db && options.character === undefined && options.db === undefined) {
        const sources = await loadSettingSources(false);
        character = sources.character;
        db = sources.db;
        dbAvailable = sources.dbAvailable;
      }

      if (character) {
        const charDesc = firstNonEmpty(character.description, character.desc);
        if (charDesc) {
          parts.characterDescription = charDesc;
          stats.character = 'found';
        }

        const chat = currentChatContext?.chat || getCurrentCharacterChat(character);
        const chatSource = currentChatContext?.chat === chat
          ? currentChatContext.source
          : chat ? 'fallback' : 'missing';
        stats.chatLoreSource = chatSource;
        const note = String(chat?.note || '').trim();
        if (note) {
          parts.authorNote = note;
          stats.authorNote = 'found';
          stats.authorNoteSource = chatSource;
        }
      }

      if (dbAvailable && db) {
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

      const loreCandidates = Array.isArray(options.loreCandidates)
        ? options.loreCandidates
        : collectLorebookCandidates(character, db, currentChatContext);
      const activeLorebooks = Array.isArray(options.activeLorebooks)
        ? options.activeLorebooks
        : matchActiveLorebooksLikeRisu(normalizeRequestMessages(messages), loreCandidates, {
          scanWindow: 10,
          fullWordMatching: character?.loreSettings?.fullWordMatching === true,
          recursiveScanning: character?.loreSettings?.recursiveScanning !== false,
        }).activeLorebooks;
      parts.activeLorebooks = activeLorebooks;
      stats.loreCandidates = loreCandidates.length;
      stats.activeLorebooks = activeLorebooks.length;
      if (options.loreStats) {
        stats.loreMatchMode = 'key-based';
        stats.loreRecursiveMatches = options.loreStats.recursiveMatches || 0;
        stats.loreScanWindow = options.loreStats.scanWindow || 0;
        stats.moduleLoreCandidates = options.loreStats.moduleLoreCandidates || 0;
      }

      return {
        content: formatSettingBlocks(parts),
        stats,
      };
    }

    function normalizeRequestMessages(messages) {
      return (Array.isArray(messages) ? messages : [])
        .filter(msg => msg?.role === 'user' || msg?.role === 'assistant')
        .map(msg => ({
          role: msg.role,
          content: String(msg.content || ''),
        }))
        .filter(msg => msg.content.trim());
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

    async function resolveCurrentFirstMessage(chat, debugLog) {
      const empty = {
        message: '',
        included: false,
        source: '',
        index: null,
        error: '',
      };

      let character = null;
      try {
        character = await Risuai.getCharacter();
      } catch (err) {
        const error = `getCharacter: ${err.message}`;
        if (debugLog) console.log(`Agents! first message: ${error}`);
        return { ...empty, error };
      }

      if (!character || character.type === 'group') {
        return { ...empty, source: character?.type === 'group' ? 'group-skipped' : 'character-missing' };
      }

      const firstMessage = String(character.firstMessage || '').trim();
      const alternateGreetings = Array.isArray(character.alternateGreetings) ? character.alternateGreetings : [];
      const rawIndex = Number(chat?.fmIndex);
      const index = Number.isInteger(rawIndex) ? rawIndex : -1;

      if (index >= 0) {
        const alternate = String(alternateGreetings[index] || '').trim();
        if (alternate) {
          return {
            ...empty,
            message: alternate,
            source: `alternateGreetings[${index}]`,
            index,
          };
        }

        return {
          ...empty,
          message: firstMessage,
          source: `alternateGreetings[${index}]->firstMessage`,
          index,
          error: alternateGreetings[index] === undefined ? 'alternate greeting not found' : 'alternate greeting empty',
        };
      }

      return {
        ...empty,
        message: firstMessage,
        source: 'firstMessage',
        index: -1,
      };
    }

    function withVirtualFirstMessage(messages, firstMessageInfo) {
      const content = String(firstMessageInfo?.message || '').trim();
      if (!content) return { messages, included: false };

      const firstStored = Array.isArray(messages) ? messages[0] : null;
      if (firstStored?.role === 'assistant' && sameChatContent(firstStored.content, content)) {
        return { messages, included: false };
      }

      return {
        messages: [{ role: 'assistant', content }, ...messages],
        included: true,
      };
    }

    function sameChatContent(left, right) {
      return normalizeForMatch(left) === normalizeForMatch(right);
    }

    async function buildBasicPlaceholderContext(chat, debugLog) {
      const context = {
        characterName: '',
        userName: 'User',
        userSource: 'fallback:User',
        error: '',
      };

      try {
        const character = await Risuai.getCharacter();
        context.characterName = firstNonEmpty(character?.nickname, character?.name);
      } catch (err) {
        context.error = `getCharacter: ${err.message}`;
        if (debugLog) console.log(`Agents! placeholders: ${context.error}`);
      }

      let db = null;
      try {
        db = await Risuai.getDatabase(['personas', 'selectedPersona']);
      } catch (err) {
        context.error = [context.error, `getDatabase: ${err.message}`].filter(Boolean).join('; ');
        if (debugLog) console.log(`Agents! placeholders: getDatabase: ${err.message}`);
      }

      const bindedPersona = String(chat?.bindedPersona || '').trim();
      const personas = Array.isArray(db?.personas) ? db.personas : [];
      if (bindedPersona && personas.length) {
        const persona = personas.find(item => item?.id === bindedPersona || item?.name === bindedPersona);
        const personaName = String(persona?.name || '').trim();
        if (personaName) {
          context.userName = personaName;
          context.userSource = 'chat.bindedPersona';
        } else {
          context.userSource = 'bindedPersona-not-found:User';
        }
      } else if (bindedPersona) {
        context.userSource = db ? 'bindedPersona-not-found:User' : 'db-unavailable:User';
      } else {
        context.userSource = 'fallback:User';
      }

      return context;
    }

    function applyBasicRisuPlaceholdersToMessages(messages, placeholderContext) {
      let applied = false;
      const converted = (Array.isArray(messages) ? messages : []).map(message => {
        const content = applyBasicRisuPlaceholders(message.content, placeholderContext);
        if (content !== message.content) applied = true;
        return content === message.content ? message : { ...message, content };
      });
      return { messages: converted, applied };
    }

    function applyBasicRisuPlaceholders(text, placeholderContext) {
      let result = String(text || '');
      const characterName = String(placeholderContext?.characterName || '');
      if (characterName) {
        result = result.replace(/\{\{char\}\}/gi, characterName);
      }
      return result.replace(/\{\{user\}\}/gi, placeholderContext?.userName || 'User');
    }

    function buildAgentCbsContext(options = {}) {
      const character = options.character || null;
      const db = options.db || null;
      const chat = options.currentChatContext?.chat || getCurrentCharacterChat(character);
      const rawMessages = Array.isArray(chat?.message) ? chat.message : null;
      const fallbackMessageCount = options.chatContext?.messageCount
        ?? (Array.isArray(options.chatContext?.messages) ? options.chatContext.messages.length : 0);
      const messageCount = rawMessages
        ? rawMessages.length
        : Math.max(0, parseInt(fallbackMessageCount, 10) || 0);
      const user = resolveAgentCbsUserName(db, chat);

      return {
        characterName: firstNonEmpty(character?.nickname, character?.name),
        userName: user.name,
        userSource: user.source,
        chatVars: normalizeAgentCbsChatVars(chat?.scriptstate),
        globalVars: normalizeAgentCbsChatVars(db?.globalChatVariables),
        defaultVars: parseAgentCbsDefaultVariables(character?.defaultVariables),
        randomSeedText: `${String(character?.chaId ?? '')}${String(chat?.id ?? '')}`,
        randomMessageCount: messageCount,
        characterId: String(character?.chaId ?? ''),
        chatId: String(chat?.id ?? ''),
      };
    }

    function resolveAgentCbsUserName(db, chat) {
      const personas = Array.isArray(db?.personas) ? db.personas : [];
      const bindedPersona = String(chat?.bindedPersona || '').trim();
      if (bindedPersona && personas.length) {
        const persona = personas.find(item => item?.id === bindedPersona || item?.name === bindedPersona);
        const personaName = String(persona?.name || '').trim();
        if (personaName) return { name: personaName, source: 'chat.bindedPersona' };
      }

      const selectedPersona = getSelectedPersona(db);
      const selectedName = String(selectedPersona?.name || '').trim();
      if (selectedName) return { name: selectedName, source: 'selectedPersona' };

      return { name: 'User', source: bindedPersona ? 'persona-not-found:User' : 'fallback:User' };
    }

    function normalizeAgentCbsChatVars(scriptstate) {
      const vars = {};
      if (!scriptstate || typeof scriptstate !== 'object') return vars;
      Object.entries(scriptstate).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        vars[String(key)] = String(value);
      });
      return vars;
    }

    function parseAgentCbsDefaultVariables(template) {
      const vars = {};
      try {
        if (!template) return vars;
        String(template).split('\n').forEach((line) => {
          const [key, value] = line.split('=');
          if (key && value) vars[key] = value;
        });
      } catch (err) {
        // Ignore malformed default variable templates. Missing vars resolve to null.
      }
      return vars;
    }

    function readAgentCbsVar(name, cbsContext) {
      const rawName = String(name || '').trim();
      if (!rawName) return 'null';
      const bareName = rawName.startsWith('$') ? rawName.slice(1) : rawName;
      const chatVars = cbsContext?.chatVars || {};
      const defaultVars = cbsContext?.defaultVars || {};
      const keys = [rawName, `$${bareName}`, bareName];
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(chatVars, key)) return String(chatVars[key]);
      }
      for (const key of [bareName, rawName]) {
        if (Object.prototype.hasOwnProperty.call(defaultVars, key)) return String(defaultVars[key]);
      }
      return 'null';
    }

    function readAgentCbsGlobalVar(name, cbsContext) {
      const rawName = String(name || '').trim();
      if (!rawName) return 'null';
      const globalVars = cbsContext?.globalVars || {};
      if (Object.prototype.hasOwnProperty.call(globalVars, rawName)) return String(globalVars[rawName]);
      return 'null';
    }

    function agentCbsCalcString(expression, cbsContext) {
      let depthText = [''];
      const text = String(expression || '');
      for (let idx = 0; idx < text.length; idx += 1) {
        const char = text[idx];
        if (char === '(') {
          depthText.push('');
        } else if (char === ')' && depthText.length > 1) {
          const result = agentCbsExecuteRpnCalculation(depthText.pop(), cbsContext);
          depthText[depthText.length - 1] += result;
        } else {
          depthText[depthText.length - 1] += char;
        }
      }
      return agentCbsExecuteRpnCalculation(depthText.join(''), cbsContext);
    }

    function agentCbsExecuteRpnCalculation(expression, cbsContext) {
      const text = String(expression || '')
        .replace(/\$([a-zA-Z0-9_]+)/g, (_, key) => agentCbsNumberForCalc(readAgentCbsVar(key, cbsContext)))
        .replace(/\@([a-zA-Z0-9_]+)/g, (_, key) => agentCbsNumberForCalc(readAgentCbsGlobalVar(key, cbsContext)))
        .replace(/&&/g, '&')
        .replace(/\|\|/g, '|')
        .replace(/<=/g, '≤')
        .replace(/>=/g, '≥')
        .replace(/==/g, '=')
        .replace(/!=/g, '≠')
        .replace(/null/gi, '0');
      return agentCbsCalculateRpn(agentCbsToRpn(text));
    }

    function agentCbsNumberForCalc(value) {
      const parsed = parseFloat(String(value ?? ''));
      return Number.isNaN(parsed) ? '0' : parsed.toString();
    }

    function agentCbsToRpn(expression) {
      let outputQueue = '';
      const operatorStack = [];
      const operators = {
        '+': { precedence: 2, associativity: 'Left' },
        '-': { precedence: 2, associativity: 'Left' },
        '*': { precedence: 3, associativity: 'Left' },
        '/': { precedence: 3, associativity: 'Left' },
        '^': { precedence: 4, associativity: 'Left' },
        '%': { precedence: 3, associativity: 'Left' },
        '<': { precedence: 1, associativity: 'Left' },
        '>': { precedence: 1, associativity: 'Left' },
        '|': { precedence: 1, associativity: 'Left' },
        '&': { precedence: 1, associativity: 'Left' },
        '≤': { precedence: 1, associativity: 'Left' },
        '≥': { precedence: 1, associativity: 'Left' },
        '=': { precedence: 1, associativity: 'Left' },
        '≠': { precedence: 1, associativity: 'Left' },
        '!': { precedence: 5, associativity: 'Right' },
      };
      const operatorKeys = Object.keys(operators);
      const compact = String(expression || '').replace(/\s+/g, '');
      const expressionParts = [];
      let lastToken = '';

      for (let idx = 0; idx < compact.length; idx += 1) {
        const char = compact[idx];
        if (char === '-' && (idx === 0 || operatorKeys.includes(compact[idx - 1]) || compact[idx - 1] === '(')) {
          lastToken += char;
        } else if (operatorKeys.includes(char)) {
          expressionParts.push(lastToken !== '' ? lastToken : '0');
          lastToken = '';
          expressionParts.push(char);
        } else {
          lastToken += char;
        }
      }

      expressionParts.push(lastToken !== '' ? lastToken : '0');

      expressionParts.forEach((token) => {
        if (!Number.isNaN(parseFloat(token))) {
          outputQueue += `${parseFloat(token)} `;
        } else if (operatorKeys.includes(token)) {
          while (operatorStack.length > 0) {
            const top = operatorStack[operatorStack.length - 1];
            if ((operators[token].associativity === 'Left' && operators[token].precedence <= operators[top].precedence)
              || (operators[token].associativity === 'Right' && operators[token].precedence < operators[top].precedence)) {
              outputQueue += `${operatorStack.pop()} `;
            } else {
              break;
            }
          }
          operatorStack.push(token);
        } else if (token !== '') {
          outputQueue += '0 ';
        }
      });

      while (operatorStack.length > 0) {
        outputQueue += `${operatorStack.pop()} `;
      }

      return outputQueue.trim();
    }

    function agentCbsCalculateRpn(expression) {
      const stack = [];
      String(expression || '').split(' ').filter(Boolean).forEach((token) => {
        if (!Number.isNaN(parseFloat(token))) {
          stack.push(parseFloat(token));
          return;
        }

        const b = stack.pop() ?? 0;
        const a = stack.pop() ?? 0;
        switch (token) {
          case '+': stack.push(a + b); break;
          case '-': stack.push(a - b); break;
          case '*': stack.push(a * b); break;
          case '/': stack.push(a / b); break;
          case '^': stack.push(a ** b); break;
          case '%': stack.push(a % b); break;
          case '<': stack.push(a < b ? 1 : 0); break;
          case '>': stack.push(a > b ? 1 : 0); break;
          case '|': stack.push(a || b); break;
          case '&': stack.push(a && b); break;
          case '≤': stack.push(a <= b ? 1 : 0); break;
          case '≥': stack.push(a >= b ? 1 : 0); break;
          case '=': stack.push(a === b ? 1 : 0); break;
          case '≠': stack.push(a !== b ? 1 : 0); break;
          case '!': stack.push(b ? 0 : 1); break;
          default: stack.push(0); break;
        }
      });

      if (!stack.length) return 0;
      const value = stack.pop();
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    }

    function hashAgentCbsContext(cbsContext) {
      const hasher = createTextHasher()
        .update('agent-cbs')
        .update(cbsContext?.characterName || '')
        .update(cbsContext?.userName || '')
        .update(cbsContext?.randomSeedText || '')
        .update(cbsContext?.randomMessageCount ?? 0);
      const appendObject = (label, value) => {
        const entries = Object.entries(value || {}).sort((a, b) => a[0].localeCompare(b[0]));
        hasher.update(label).update(entries.length);
        entries.forEach(([key, entryValue]) => {
          hasher.update(key).update(entryValue);
        });
      };
      appendObject('chatVars', cbsContext?.chatVars);
      appendObject('globalVars', cbsContext?.globalVars);
      appendObject('defaultVars', cbsContext?.defaultVars);
      return hasher.digest();
    }

    function formatPromptForRunLog(messages) {
      return (Array.isArray(messages) ? messages : [])
        .map((message, idx) => `[${idx}] ${message?.role || '(none)'}\n${String(message?.content ?? '')}`)
        .join('\n\n');
    }

    function renderAgentCbsMessages(messages, cbsContext, options = {}) {
      const state = createAgentCbsRenderState(options);
      const rendered = (Array.isArray(messages) ? messages : []).map((message) => {
        const original = String(message?.content ?? '');
        const content = renderAgentCbsText(original, cbsContext, state, 0);
        if (content !== original) state.applied = true;
        return content === original ? message : { ...message, content };
      });
      if (options.debugLog && state.warnings.length) {
        console.log(`Agents! CBS warnings${options.label ? ` (${options.label})` : ''}: ${state.warnings.join('; ')}`);
      }
      return {
        messages: rendered,
        warnings: state.warnings.slice(),
        applied: state.applied,
      };
    }

    function createAgentCbsRenderState(options = {}) {
      return {
        warnings: [],
        warningSet: new Set(),
        applied: false,
        literals: [],
        label: options.label || '',
      };
    }

    function renderAgentCbsText(text, cbsContext, state, depth = 0) {
      let current = String(text ?? '');
      if (!current.includes('{{')) {
        return depth === 0 ? restoreAgentCbsLiterals(current, state) : current;
      }

      for (let pass = 0; pass < AGENT_CBS_MAX_PASSES; pass += 1) {
        const before = current;
        let blockCount = 0;
        let blockMatch = findInnermostAgentCbsBlock(current, cbsContext, state, depth);
        while (blockMatch && blockCount < AGENT_CBS_MAX_BLOCKS) {
          const replacement = renderAgentCbsBlock(blockMatch, cbsContext, state, depth);
          current = `${current.slice(0, blockMatch.start.tag.start)}${replacement}${current.slice(blockMatch.end.tag.end)}`;
          state.applied = true;
          blockCount += 1;
          blockMatch = findInnermostAgentCbsBlock(current, cbsContext, state, depth);
        }

        const simpleResult = replaceAgentCbsSimpleTagsOnce(current, cbsContext, state, depth);
        current = simpleResult.text;
        if (current === before) break;
      }

      warnUnresolvedAgentCbs(current, state);
      return depth === 0 ? restoreAgentCbsLiterals(current, state) : current;
    }

    function findAgentCbsTags(text) {
      const tags = [];
      const source = String(text || '');
      let idx = 0;
      while (idx < source.length) {
        const start = source.indexOf('{{', idx);
        if (start === -1) break;
        let pointer = start + 2;
        let depth = 1;
        while (pointer < source.length) {
          if (source.startsWith('{{', pointer)) {
            depth += 1;
            pointer += 2;
            continue;
          }
          if (source.startsWith('}}', pointer)) {
            depth -= 1;
            if (depth === 0) {
              const end = pointer + 2;
              tags.push({
                start,
                end,
                contentStart: start + 2,
                contentEnd: pointer,
                content: source.slice(start + 2, pointer),
              });
              idx = end;
              break;
            }
            pointer += 2;
            continue;
          }
          pointer += 1;
        }
        if (depth !== 0) break;
      }
      return tags;
    }

    function findInnermostAgentCbsBlock(text, cbsContext, state, depth) {
      const stack = [];
      const tags = findAgentCbsTags(text);
      for (const tag of tags) {
        const raw = String(tag.content || '').trim();
        if (!raw || raw === ':else') continue;

        if (raw.startsWith('#')) {
          const renderedHeader = renderAgentCbsText(tag.content, cbsContext, state, depth + 1).trim();
          const block = agentCbsBlockStartMatcher(renderedHeader, state);
          if (block) stack.push({ tag, block });
          continue;
        }

        if (isAgentCbsCloseTag(raw) && stack.length) {
          return { start: stack.pop(), end: { tag }, source: text };
        }
      }
      return null;
    }

    function replaceAgentCbsSimpleTagsOnce(text, cbsContext, state, depth) {
      const tags = findAgentCbsTags(text);
      let result = String(text || '');
      let changed = false;
      for (let idx = tags.length - 1; idx >= 0; idx -= 1) {
        const tag = tags[idx];
        const raw = String(tag.content || '').trim();
        if (isAgentCbsBlockBoundary(raw)) continue;

        const renderedContent = renderAgentCbsText(tag.content, cbsContext, state, depth + 1);
        const replacement = agentCbsMatcher(renderedContent, cbsContext, state);
        if (replacement !== null) {
          result = `${result.slice(0, tag.start)}${replacement}${result.slice(tag.end)}`;
          state.applied = true;
          changed = true;
        }
      }
      return { text: result, changed };
    }

    function isAgentCbsBlockBoundary(raw) {
      return raw === ':else' || raw.startsWith('#') || raw.startsWith('/');
    }

    function isAgentCbsCloseTag(raw) {
      if (raw === '/') return true;
      if (!String(raw || '').startsWith('/')) return false;
      const normalized = normalizeAgentCbsName(String(raw || '').replace(/^\//, ''));
      return normalized === 'if' || normalized === 'ifpure' || normalized === 'when';
    }

    function agentCbsBlockStartMatcher(rawHeader, state) {
      const header = String(rawHeader || '').trim();
      if (header.startsWith('#if_pure')) {
        return agentCbsTruthy(extractAgentCbsBlockState(header, '#if_pure'))
          ? { type: 'ifpure' }
          : { type: 'ignore' };
      }

      if (header.startsWith('#if')) {
        return agentCbsTruthy(extractAgentCbsBlockState(header, '#if'))
          ? { type: 'parse' }
          : { type: 'ignore' };
      }

      if (!header.startsWith('#when')) return null;

      if (header.startsWith('#when ')) {
        return agentCbsTruthy(header.split(' ', 2)[1])
          ? { type: 'newif' }
          : { type: 'newif-falsy' };
      }

      if (!header.startsWith('#when::')) {
        return { type: 'newif-falsy' };
      }

      const statement = header.split('::').slice(1);
      if (statement.length === 1) {
        return agentCbsTruthy(statement[0]) ? { type: 'newif' } : { type: 'newif-falsy' };
      }

      let mode = 'normal';
      while (statement.length > 1) {
        const condition = statement.pop();
        const operator = normalizeAgentCbsName(statement.pop());
        switch (operator) {
          case 'not':
            statement.push(agentCbsTruthy(condition) ? '0' : '1');
            break;
          case 'keep':
            mode = 'keep';
            statement.push(condition);
            break;
          case 'legacy':
            mode = 'legacy';
            statement.push(condition);
            break;
          case 'and': {
            const condition2 = statement.pop();
            statement.push(agentCbsTruthy(condition) && agentCbsTruthy(condition2) ? '1' : '0');
            break;
          }
          case 'or': {
            const condition2 = statement.pop();
            statement.push(agentCbsTruthy(condition) || agentCbsTruthy(condition2) ? '1' : '0');
            break;
          }
          case 'is': {
            const condition2 = statement.pop();
            statement.push(condition === condition2 ? '1' : '0');
            break;
          }
          case 'isnot': {
            const condition2 = statement.pop();
            statement.push(condition !== condition2 ? '1' : '0');
            break;
          }
          case '>': {
            const condition2 = statement.pop();
            statement.push(parseFloat(condition2) > parseFloat(condition) ? '1' : '0');
            break;
          }
          case '<': {
            const condition2 = statement.pop();
            statement.push(parseFloat(condition2) < parseFloat(condition) ? '1' : '0');
            break;
          }
          case '>=': {
            const condition2 = statement.pop();
            statement.push(parseFloat(condition2) >= parseFloat(condition) ? '1' : '0');
            break;
          }
          case '<=': {
            const condition2 = statement.pop();
            statement.push(parseFloat(condition2) <= parseFloat(condition) ? '1' : '0');
            break;
          }
          default:
            recordAgentCbsWarning(state, `unsupported CBS condition operator preserved: ${operator || '(empty)'}`);
            return null;
        }
      }

      const truthy = agentCbsTruthy(statement[0]);
      if (mode === 'legacy') return truthy ? { type: 'parse' } : { type: 'ignore' };
      return {
        type: truthy ? 'newif' : 'newif-falsy',
        type2: mode === 'keep' ? 'keep' : '',
      };
    }

    function extractAgentCbsBlockState(header, prefix) {
      const rest = String(header || '').slice(prefix.length).trim();
      if (rest.startsWith('::')) return rest.slice(2);
      return rest.split(' ', 1)[0] || '';
    }

    function renderAgentCbsBlock(match, cbsContext, state, depth) {
      const body = match?.source
        ? String(match.source).slice(match.start.tag.end, match.end.tag.start)
        : '';
      const block = match.start.block;
      switch (block.type) {
        case 'ignore':
          return '';
        case 'parse':
          return renderAgentCbsText(agentCbsTrimLines(body.trim()), cbsContext, state, depth + 1);
        case 'ifpure':
          return storeAgentCbsLiteral(state, body);
        case 'newif':
        case 'newif-falsy':
          return renderAgentCbsText(selectAgentCbsWhenBranch(body, block), cbsContext, state, depth + 1);
        default:
          return '';
      }
    }

    function selectAgentCbsWhenBranch(body, block) {
      const text = String(body || '');
      const truthy = block.type === 'newif';
      const lines = text.split('\n');

      if (lines.length === 1) {
        const elseIndex = text.indexOf('{{:else}}');
        if (elseIndex !== -1) {
          return truthy ? text.slice(0, elseIndex) : text.slice(elseIndex + '{{:else}}'.length);
        }
        return truthy ? text : '';
      }

      const selected = lines.slice();
      const elseLine = selected.findIndex(line => line.trim() === '{{:else}}');
      if (elseLine !== -1 && truthy) {
        selected.splice(elseLine);
      } else if (elseLine !== -1 && !truthy) {
        selected.splice(0, elseLine + 1);
      } else if (elseLine === -1 && !truthy) {
        return '';
      }

      if (block.type2 !== 'keep') {
        while (selected.length > 0 && selected[0].trim() === '') selected.shift();
        while (selected.length > 0 && selected[selected.length - 1].trim() === '') selected.pop();
      }

      return selected.join('\n');
    }

    function agentCbsTrimLines(text) {
      return String(text || '').split('\n').map(line => line.trimStart()).join('\n').trim();
    }

    function agentCbsMatcher(rawContent, cbsContext, state) {
      const content = String(rawContent || '');
      if (content.startsWith('?')) {
        const expression = content.slice(1).trim();
        if (expression) return agentCbsCalcString(expression, cbsContext).toString();
      }

      const colonIndex = content.indexOf(':');
      const parts = colonIndex !== -1 && content[colonIndex + 1] === ':'
        ? content.split('::')
        : content.split(':');
      const name = normalizeAgentCbsName(parts[0]);
      const args = parts.slice(1).map(arg => String(arg ?? ''));

      switch (name) {
        case 'char':
        case 'bot':
          return cbsContext?.characterName || '';
        case 'user':
          return cbsContext?.userName || 'User';
        case 'getvar':
          return readAgentCbsVar(args[0], cbsContext);
        case 'getglobalvar':
          return readAgentCbsGlobalVar(args[0], cbsContext);
        case 'calc':
          return agentCbsCalcString(args[0] || '', cbsContext).toString();
        case 'equal':
          return args[0] === args[1] ? '1' : '0';
        case 'notequal':
          return args[0] !== args[1] ? '1' : '0';
        case 'greater':
          return Number(args[0]) > Number(args[1]) ? '1' : '0';
        case 'less':
          return Number(args[0]) < Number(args[1]) ? '1' : '0';
        case 'greaterequal':
          return Number(args[0]) >= Number(args[1]) ? '1' : '0';
        case 'lessequal':
          return Number(args[0]) <= Number(args[1]) ? '1' : '0';
        case 'contains':
          return String(args[0] || '').includes(String(args[1] || '')) ? '1' : '0';
        case 'startswith':
          return String(args[0] || '').startsWith(String(args[1] || '')) ? '1' : '0';
        case 'endswith':
          return String(args[0] || '').endsWith(String(args[1] || '')) ? '1' : '0';
        case 'trim':
          return String(args[0] || '').trim();
        case 'lower':
          return String(args[0] || '').toLocaleLowerCase();
        case 'upper':
          return String(args[0] || '').toLocaleUpperCase();
        case 'length':
          return String(args[0] || '').length.toString();
        case 'blank':
        case 'none':
          return '';
        case 'br':
        case 'newline':
          return '\n';
        case 'bo':
        case 'ddecbo':
          return storeAgentCbsLiteral(state, '{{');
        case 'bc':
        case 'ddecbc':
          return storeAgentCbsLiteral(state, '}}');
        case 'decbo':
          return '{';
        case 'decbc':
          return '}';
        case 'pick':
          return agentCbsRandomPick(args, agentCbsPickHashRand(cbsContext?.randomMessageCount || 0, cbsContext?.randomSeedText || ''));
        case 'rollp':
        case 'rollpick':
          return agentCbsRollPick(args, cbsContext);
        case 'and':
          return args[0] === '1' && args[1] === '1' ? '1' : '0';
        case 'or':
          return args[0] === '1' || args[1] === '1' ? '1' : '0';
        case 'not':
          return args[0] === '1' ? '0' : '1';
        default:
          if (name) recordAgentCbsUnsupportedWarning(name, content, state);
          return null;
      }
    }

    function agentCbsRandomPick(args, rand) {
      if (!args.length) return String(rand);
      let arr = [];
      if (args.length === 1) {
        const arg = String(args[0] || '');
        if (arg.startsWith('[') && arg.endsWith(']')) {
          arr = parseAgentCbsArray(arg);
        } else {
          arr = arg.replace(/\\,/g, '§X').split(/\:|\,/g);
        }
      } else {
        arr = args;
      }
      if (!arr.length) return '';
      const index = Math.min(arr.length - 1, Math.max(0, Math.floor(rand * arr.length)));
      const element = arr[index];
      return typeof element === 'string' ? element.replace(/§X/g, ',') : JSON.stringify(element) ?? '';
    }

    function parseAgentCbsArray(value) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : String(value || '').split('§');
      } catch (err) {
        return String(value || '').split('§');
      }
    }

    function agentCbsRollPick(args, cbsContext) {
      if (!args.length) return '1';
      const notation = String(args[0] || '').split('d');
      let num = 1;
      let sides = 6;
      if (notation.length === 2) {
        num = Number(notation[0] || 1);
        sides = Number(notation[1] || 6);
      } else if (notation.length === 1) {
        sides = Number(notation[0]);
      }
      if (Number.isNaN(num) || Number.isNaN(sides) || num < 1 || sides < 1) return 'NaN';

      let total = 0;
      const baseMessageCount = cbsContext?.randomMessageCount || 0;
      const seedText = cbsContext?.randomSeedText || '';
      for (let idx = 0; idx < num; idx += 1) {
        total += Math.floor(agentCbsPickHashRand(baseMessageCount + (idx * 15), seedText) * sides) + 1;
      }
      return total.toString();
    }

    function agentCbsPickHashRand(cid, word) {
      let hashAddress = 5515;
      const rand = (value) => {
        const text = String(value || '');
        for (let counter = 0; counter < text.length; counter += 1) {
          hashAddress = ((hashAddress << 5) + hashAddress) + text.charCodeAt(counter);
        }
        return hashAddress;
      };
      const randF = agentCbsSfc32(rand(word), rand(word), rand(word), rand(word));
      const v = Math.max(0, parseInt(cid, 10) || 0) % 1000;
      for (let idx = 0; idx < v; idx += 1) randF();
      return randF();
    }

    function agentCbsSfc32(a, b, c, d) {
      return function nextRand() {
        a |= 0; b |= 0; c |= 0; d |= 0;
        const t = (((a + b) | 0) + d) | 0;
        d = (d + 1) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = ((c << 21) | (c >>> 11));
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
      };
    }

    function agentCbsTruthy(value) {
      return value === 'true' || value === '1';
    }

    function normalizeAgentCbsName(value) {
      return String(value || '').toLocaleLowerCase().replace(/[\s_-]/g, '');
    }

    function storeAgentCbsLiteral(state, text) {
      const idx = state.literals.length;
      const token = `${AGENT_CBS_LITERAL_PREFIX}${idx}${AGENT_CBS_LITERAL_SUFFIX}`;
      state.literals.push(String(text ?? ''));
      return token;
    }

    function restoreAgentCbsLiterals(text, state) {
      let result = String(text ?? '');
      if (!state?.literals?.length) return result;
      state.literals.forEach((literal, idx) => {
        result = result.split(`${AGENT_CBS_LITERAL_PREFIX}${idx}${AGENT_CBS_LITERAL_SUFFIX}`).join(literal);
      });
      return result;
    }

    function recordAgentCbsUnsupportedWarning(name, rawContent, state) {
      if (['random', 'roll', 'dice', 'randint'].includes(name)) {
        recordAgentCbsWarning(state, `non-deterministic CBS preserved: {{${summarizeAgentCbsTag(rawContent)}}}`);
        return;
      }
      if (['setvar', 'addvar', 'setdefaultvar', 'setglobalvar', 'addglobalvar', 'setdefaultglobalvar'].includes(name)) {
        recordAgentCbsWarning(state, `state-changing CBS preserved: {{${summarizeAgentCbsTag(rawContent)}}}`);
        return;
      }
      recordAgentCbsWarning(state, `unsupported CBS preserved: {{${summarizeAgentCbsTag(rawContent)}}}`);
    }

    function warnUnresolvedAgentCbs(text, state) {
      findAgentCbsTags(text).forEach((tag) => {
        const raw = String(tag.content || '').trim();
        if (!raw || raw === ':else' || raw.startsWith('/')) return;
        if (raw.startsWith('#')) {
          recordAgentCbsWarning(state, `unresolved CBS block preserved: {{${summarizeAgentCbsTag(raw)}}}`);
          return;
        }
        const name = normalizeAgentCbsName(raw.split(raw.includes('::') ? '::' : ':')[0]);
        if (name && !isAgentCbsSupportedFunction(name)) {
          recordAgentCbsUnsupportedWarning(name, raw, state);
        }
      });
    }

    function isAgentCbsSupportedFunction(name) {
      return [
        'char', 'bot', 'user', 'getvar', 'getglobalvar', 'calc',
        'equal', 'notequal', 'greater', 'less', 'greaterequal', 'lessequal',
        'contains', 'startswith', 'endswith', 'trim', 'lower', 'upper', 'length',
        'blank', 'none', 'br', 'newline', 'bo', 'bc', 'ddecbo', 'ddecbc', 'decbo', 'decbc',
        'pick', 'rollp', 'rollpick', 'and', 'or', 'not',
      ].includes(name);
    }

    function recordAgentCbsWarning(state, warning) {
      if (!state || !warning) return;
      if (state.warningSet.has(warning)) return;
      state.warningSet.add(warning);
      if (state.warnings.length < AGENT_CBS_MAX_WARNINGS) {
        state.warnings.push(warning);
      }
    }

    function summarizeAgentCbsTag(rawContent) {
      const text = String(rawContent || '').replace(/\s+/g, ' ').trim();
      return text.length > 90 ? `${text.slice(0, 87)}...` : text;
    }

    function mergeAgentCbsWarnings(...warningLists) {
      const seen = new Set();
      const merged = [];
      warningLists.flat().forEach((warning) => {
        const text = String(warning || '').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        if (merged.length < AGENT_CBS_MAX_WARNINGS) merged.push(text);
      });
      return merged;
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
        firstMessageIncluded: false,
        firstMessageSource: '',
        firstMessageIndex: null,
        firstMessageError: '',
        placeholderReplacementApplied: false,
        placeholderUserSource: '',
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

      const firstMessageInfo = await resolveCurrentFirstMessage(chat, debugLog);
      const placeholderContext = await buildBasicPlaceholderContext(chat, debugLog);

      const rawMessages = chat?.message;
      if (!Array.isArray(rawMessages)) {
        return {
          ...fallback,
          error: `chat.message array not found; keys=${objectKeysPreview(chat)}`,
          characterIndex,
          chatIndex,
          firstMessageSource: firstMessageInfo.source,
          firstMessageIndex: firstMessageInfo.index,
          firstMessageError: firstMessageInfo.error,
          placeholderUserSource: placeholderContext.userSource,
        };
      }

      const normalizedMessages = rawMessages
        .map(normalizeStoredChatMessage)
        .filter(Boolean);
      const firstMessageContext = withVirtualFirstMessage(normalizedMessages, firstMessageInfo);
      const contextMessages = firstMessageContext.messages;
      const lastUserIndex = findLastIndex(contextMessages, msg => msg.role === 'user');
      if (lastUserIndex < 0) {
        return {
          ...fallback,
          source: firstMessageContext.included ? 'chat.message+first-message' : 'chat.message',
          error: 'user message not found in chat.message',
          characterIndex,
          chatIndex,
          storedMessageCount: normalizedMessages.length,
          firstMessageIncluded: firstMessageContext.included,
          firstMessageSource: firstMessageInfo.source,
          firstMessageIndex: firstMessageInfo.index,
          firstMessageError: firstMessageInfo.error,
          placeholderUserSource: placeholderContext.userSource,
        };
      }

      const trimmedToCurrentUser = lastUserIndex < contextMessages.length - 1;
      const placeholderResult = applyBasicRisuPlaceholdersToMessages(
        contextMessages.slice(0, lastUserIndex + 1),
        placeholderContext,
      );
      const messages = placeholderResult.messages;
      const sourceParts = ['chat.message'];
      if (firstMessageContext.included) sourceParts.push('first-message');
      if (trimmedToCurrentUser) sourceParts.push('trimmed-to-last-user');

      return {
        available: true,
        messages,
        source: sourceParts.join('+'),
        error: '',
        characterIndex,
        chatIndex,
        messageCount: messages.length,
        storedMessageCount: normalizedMessages.length,
        appendedCurrentUser: false,
        trimmedToCurrentUser,
        firstMessageIncluded: firstMessageContext.included,
        firstMessageSource: firstMessageInfo.source,
        firstMessageIndex: firstMessageInfo.index,
        firstMessageError: firstMessageInfo.error,
        placeholderReplacementApplied: placeholderResult.applied,
        placeholderUserSource: placeholderContext.userSource,
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

    function collectLorebookCandidates(character, db, currentChatContext = null) {
      const candidates = [];
      const seen = new Set();

      const addLore = (lore, sourcePrefix, sourceType = 'unknown', sourceOrder = 0) => {
        if (!lore) return;
        const content = firstNonEmpty(lore.content, lore.prompt, lore.text, lore.entry);
        if (!content) return;
        const label = firstNonEmpty(lore.comment, lore.name, lore.displayName, sourcePrefix, '로어북');
        const dedupeKey = normalizeForMatch(`${sourceType}\n${label}\n${content}\n${firstNonEmpty(lore.key, lore.keys, lore.keywords)}`);
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        candidates.push(normalizeLorebookCandidate(lore, label, content, sourcePrefix, sourceType, sourceOrder, candidates.length));
      };

      if (character) {
        if (Array.isArray(character.globalLore)) {
          character.globalLore.forEach((lore, idx) => addLore(lore, '캐릭터 로어북', 'character', idx));
        }

        const chat = currentChatContext?.chat || getCurrentCharacterChat(character);
        if (Array.isArray(chat?.localLore)) {
          chat.localLore.forEach((lore, idx) => addLore(lore, '채팅 로어북', 'chat', idx));
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
        module.lorebook.forEach((lore, idx) => addLore(lore, `모듈 로어북: ${module.name || module.id || 'unknown'}`, 'module', idx));
      }

      return candidates;
    }

    function normalizeLorebookCandidate(lore, label, content, sourcePrefix, sourceType, sourceOrder, index) {
      const keys = splitLoreKeys(firstNonEmpty(lore.key, lore.keys, lore.keywords));
      const secondaryKeys = splitLoreKeys(firstNonEmpty(lore.secondkey, lore.secondary_keys));
      return {
        id: String(lore.id || `${sourceType}-${sourceOrder}-${index}`),
        label,
        content,
        source: sourcePrefix,
        sourceType,
        sourceOrder,
        originalIndex: index,
        key: keys.join(', '),
        keys,
        secondkey: secondaryKeys.join(', '),
        secondaryKeys,
        insertorder: Number.isFinite(Number(lore.insertorder ?? lore.order ?? lore.priority))
          ? Number(lore.insertorder ?? lore.order ?? lore.priority)
          : 100,
        alwaysActive: lore.alwaysActive === true || lore.constant === true || lore.forceActivation === true || lore.mode === 'constant',
        selective: lore.selective === true,
        useRegex: lore.useRegex === true,
        mode: String(lore.mode || 'normal'),
      };
    }

    function normalizeForMatch(text) {
      return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    function matchActiveLorebooksLikeRisu(messages, candidates, options = {}) {
      const list = Array.isArray(candidates) ? candidates : [];
      const scanWindow = Math.max(1, parseInt(options.scanWindow, 10) || 10);
      const baseMessages = normalizeRequestMessages(messages).slice(-scanWindow);
      const recursiveScanning = options.recursiveScanning !== false;
      const defaultFullWordMatching = options.fullWordMatching === true;
      const active = [];
      const activated = new Set();
      const recursiveTexts = [];
      let recursiveMatches = 0;
      let matched = true;

      while (matched) {
        matched = false;
        for (let idx = 0; idx < list.length; idx += 1) {
          if (activated.has(idx)) continue;
          const candidate = list[idx];
          if (!candidate || candidate.mode === 'folder') continue;

          const parsed = parseLorebookDecorators(candidate.content);
          const matchConfig = {
            fullWordMatching: parsed.fullWordMatching === null ? defaultFullWordMatching : parsed.fullWordMatching,
            useRecursiveTexts: parsed.noRecursiveSearch !== true,
          };
          const searchTexts = baseMessages
            .map(msg => ({ text: msg.content, recursive: false }))
            .concat(matchConfig.useRecursiveTexts ? recursiveTexts.map(text => ({ text, recursive: true })) : []);
          const result = evaluateLorebookActivation(candidate, parsed, searchTexts, matchConfig);
          if (!result.active) continue;

          const activeLore = {
            ...candidate,
            content: parsed.content,
            activationReason: result.reason,
            matchedByRecursive: result.matchedByRecursive,
          };
          active.push(activeLore);
          activated.add(idx);
          if (result.matchedByRecursive) recursiveMatches += 1;

          const itemRecursive = parsed.recursiveOverride === null
            ? recursiveScanning
            : parsed.recursiveOverride;
          if (itemRecursive) {
            recursiveTexts.push(parsed.content);
            matched = true;
          }
        }
      }

      return {
        activeLorebooks: active.sort((a, b) => (a.insertorder - b.insertorder) || (a.originalIndex - b.originalIndex)),
        stats: {
          scanWindow,
          recursiveMatches,
          moduleLoreCandidates: list.filter(item => item.sourceType === 'module').length,
        },
      };
    }

    function evaluateLorebookActivation(candidate, parsed, searchTexts, config) {
      if (parsed.forceState === 'deactivate') {
        return { active: false, reason: 'dont_activate', matchedByRecursive: false };
      }
      if (parsed.forceState === 'activate' || candidate.alwaysActive) {
        return { active: true, reason: parsed.forceState === 'activate' ? 'activate' : 'alwaysActive', matchedByRecursive: false };
      }

      const positiveGroups = [];
      if (candidate.keys.length) positiveGroups.push(candidate.keys);
      parsed.additionalKeys.forEach(keys => positiveGroups.push(keys));
      if (candidate.selective && candidate.secondaryKeys.length) positiveGroups.push(candidate.secondaryKeys);
      if (!positiveGroups.length) return { active: false, reason: 'no-key', matchedByRecursive: false };

      for (const group of parsed.excludeKeys) {
        if (searchKeyGroup(searchTexts, group, candidate.useRegex, config.fullWordMatching, false).matched) {
          return { active: false, reason: 'exclude_keys', matchedByRecursive: false };
        }
      }
      for (const group of parsed.excludeKeysAll) {
        if (searchKeyGroup(searchTexts, group, candidate.useRegex, config.fullWordMatching, true).matched) {
          return { active: false, reason: 'exclude_keys_all', matchedByRecursive: false };
        }
      }

      let matchedByRecursive = false;
      for (const group of positiveGroups) {
        const result = searchKeyGroup(searchTexts, group, candidate.useRegex, config.fullWordMatching, false);
        if (!result.matched) return { active: false, reason: 'key-missing', matchedByRecursive: false };
        matchedByRecursive = matchedByRecursive || result.matchedByRecursive;
      }
      return { active: true, reason: 'key', matchedByRecursive };
    }

    function searchKeyGroup(texts, keys, useRegex, fullWordMatching, requireAll) {
      const cleanKeys = splitLoreKeys(keys);
      if (!cleanKeys.length) return { matched: false, matchedByRecursive: false };
      let matchedCount = 0;
      let matchedByRecursive = false;
      for (const key of cleanKeys) {
        const result = searchSingleKey(texts, key, useRegex, fullWordMatching);
        if (result.matched) {
          matchedCount += 1;
          matchedByRecursive = matchedByRecursive || result.matchedByRecursive;
          if (!requireAll) return { matched: true, matchedByRecursive };
        } else if (requireAll) {
          return { matched: false, matchedByRecursive: false };
        }
      }
      return {
        matched: requireAll ? matchedCount === cleanKeys.length : false,
        matchedByRecursive,
      };
    }

    function searchSingleKey(texts, key, useRegex, fullWordMatching) {
      const sourceTexts = (Array.isArray(texts) ? texts : [])
        .map(item => (item && typeof item === 'object' && !Array.isArray(item)
          ? { text: String(item.text || ''), recursive: item.recursive === true }
          : { text: String(item || ''), recursive: false }));
      if (useRegex) {
        const regex = makeLoreRegex(key);
        if (!regex) return { matched: false, matchedByRecursive: false };
        for (let idx = 0; idx < sourceTexts.length; idx += 1) {
          regex.lastIndex = 0;
          if (regex.test(sourceTexts[idx].text)) {
            return { matched: true, matchedByRecursive: sourceTexts[idx].recursive };
          }
        }
        return { matched: false, matchedByRecursive: false };
      }

      const preparedKey = prepareLoreMatchText(key, fullWordMatching);
      if (!preparedKey) return { matched: false, matchedByRecursive: false };
      for (let idx = 0; idx < sourceTexts.length; idx += 1) {
        const preparedText = prepareLoreMatchText(sourceTexts[idx].text, fullWordMatching);
        if (fullWordMatching) {
          if (preparedText.split(/\s+/).includes(preparedKey)) {
            return { matched: true, matchedByRecursive: sourceTexts[idx].recursive };
          }
        } else if (preparedText.includes(preparedKey)) {
          return { matched: true, matchedByRecursive: sourceTexts[idx].recursive };
        }
      }
      return { matched: false, matchedByRecursive: false };
    }

    function prepareLoreMatchText(text, fullWordMatching) {
      const cleaned = String(text || '')
        .toLocaleLowerCase()
        .replace(/\{\{\/\/(.+?)\}\}/g, '')
        .replace(/\{\{comment:(.+?)\}\}/g, '')
        .trim();
      return fullWordMatching ? cleaned : cleaned.replace(/ /g, '');
    }

    function makeLoreRegex(pattern) {
      const raw = String(pattern || '').trim();
      if (!raw.startsWith('/')) return null;
      const lastSlash = raw.lastIndexOf('/');
      if (lastSlash <= 0) return null;
      const source = raw.slice(1, lastSlash);
      const flags = raw.slice(lastSlash + 1);
      try {
        return new RegExp(source, flags);
      } catch (_) {
        return null;
      }
    }

    function parseLorebookDecorators(content) {
      const result = {
        content: String(content || ''),
        additionalKeys: [],
        excludeKeys: [],
        excludeKeysAll: [],
        fullWordMatching: null,
        forceState: 'none',
        recursiveOverride: null,
        noRecursiveSearch: false,
      };

      const consume = (name, args) => applyLoreDecorator(result, name, args);
      result.content = result.content
        .replace(/\{\{\s*([^:{}\s]+)(?:::([^{}]*))?\s*\}\}/g, (match, name, rawArgs = '') => {
          return consume(name, splitDecoratorArgs(rawArgs)) ? '' : match;
        })
        .replace(/^\s*@@([a-zA-Z_][\w-]*)(?:\s+(.+?))?\s*$/gm, (match, name, rawArgs = '') => {
          return consume(name, splitDecoratorArgs(rawArgs)) ? '' : match;
        })
        .trim();

      return result;
    }

    function applyLoreDecorator(result, rawName, args) {
      const name = String(rawName || '').trim().replace(/^@@/, '').toLowerCase();
      switch (name) {
        case 'additional_keys':
          {
            const keys = splitLoreKeys(args);
            if (keys.length) result.additionalKeys.push(keys);
          }
          return true;
        case 'exclude_keys':
          {
            const keys = splitLoreKeys(args);
            if (keys.length) result.excludeKeys.push(keys);
          }
          return true;
        case 'exclude_keys_all':
          {
            const keys = splitLoreKeys(args);
            if (keys.length) result.excludeKeysAll.push(keys);
          }
          return true;
        case 'match_full_word':
          result.fullWordMatching = true;
          return true;
        case 'match_partial_word':
          result.fullWordMatching = false;
          return true;
        case 'activate':
          result.forceState = 'activate';
          return true;
        case 'dont_activate':
          result.forceState = 'deactivate';
          return true;
        case 'recursive':
          result.recursiveOverride = true;
          return true;
        case 'unrecursive':
          result.recursiveOverride = false;
          return true;
        case 'no_recursive_search':
          result.noRecursiveSearch = true;
          return true;
        case 'scan_depth':
          return true;
        default:
          return false;
      }
    }

    function splitDecoratorArgs(value) {
      if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
      const text = String(value || '').trim();
      if (!text) return [];
      if (text.includes('::')) return text.split('::').map(item => item.trim()).filter(Boolean);
      return text.split(',').map(item => item.trim()).filter(Boolean);
    }

    function splitLoreKeys(value) {
      if (Array.isArray(value)) {
        return value.flatMap(item => splitLoreKeys(item));
      }
      return String(value || '')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean);
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

    const PIPELINE_CONFIG_VERSION = 2;
    const POST_MODE_POLISH = 'polish';
    const POST_MODE_PREFIX = 'prefix';
    const POST_MODE_SUFFIX = 'suffix';
    const POST_MODES = [POST_MODE_POLISH, POST_MODE_PREFIX, POST_MODE_SUFFIX];
    const DEFAULT_OUTPUT_PRE =
      '간결한 불릿 포인트로 관찰과 제안만 정리하세요. 실제 RP 본문이나 최종 응답 문장은 작성하지 마세요.';
    const DEFAULT_OUTPUT_POST_POLISH =
      '메인 모델 응답을 수정한 최종 사용자 응답만 출력하세요. 분석 메모, 설명, 변경 목록, 접두사는 출력하지 마세요.';
    const DEFAULT_OUTPUT_POST_PREFIX =
      '현재 응답 앞에 자연스럽게 붙일 짧은 추가 텍스트만 출력하세요. 현재 응답 본문은 반복하지 마세요.';
    const DEFAULT_OUTPUT_POST_SUFFIX =
      '현재 응답 뒤에 자연스럽게 붙일 짧은 추가 텍스트만 출력하세요. 현재 응답 본문은 반복하지 마세요.';
    const DEFAULT_OUTPUT_POST = DEFAULT_OUTPUT_POST_POLISH;
    const LEGACY_DEFAULT_DIALOGUE_SYSTEM_PROMPT =
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
      '- 이름: 1문장 이하의 참고용 샘플. 장면을 진행하는 완성 대사가 아니라 어조 참고용으로만 작성';
    const DEFAULT_DIALOGUE_SYSTEM_PROMPT =
      '당신은 대사와 말투 에이전트입니다.\n' +
      '현재 상황과 캐릭터의 심리를 바탕으로 이번 응답에서 지켜야 할 \'언어적 발화 기준\'만 구체적으로 정리하세요.\n' +
      '아래 포맷을 유지하되, 확실한 정보가 없거나 중요하지 않은 항목은 "(해당 없음)"으로 둡니다.\n\n' +
      '[캐릭터별 기본 발화 스타일]\n' +
      '- 이름: 문장의 평균 길이, 어휘 수준(비속어, 전문 용어 등), 자주 쓰는 어미나 말버릇\n\n' +
      '[관계별 호칭과 경어체]\n' +
      '- A -> B: 지금 상황에서 부르는 구체적인 호칭(직함, 이름, 별명 등), 존댓말/반말 여부\n\n' +
      '[감정에 따른 말투 변형]\n' +
      '- 이름: 현재 감정 상태로 인해 억양이나 말투가 평소와 어떻게 달라졌는지 (예: 당황해서 말을 더듬음, 화가 나서 문장이 짧아짐)\n\n' +
      '[이번 응답의 대화 전략]\n' +
      '- 인물들이 대화를 통해 정보를 숨기려 하는지, 공격적으로 퍼붓는지 등 화술의 방향성\n\n' +
      '[어조 파악용 단편 샘플]\n' +
      '- 이름: 1문장 이하의 말투가 강하게 드러나는 짧은 텍스트 (내용 전개용이 아닌 어조 참고용)';

    const DEFAULT_AGENT_PRESETS = [
      {
        id: 'agent-world',
        row: 0,
        column: 0,
        name: '세계관 에이전트',
        modelPresetId: DEFAULT_MODEL_PRESET_ID,
        systemPrompt:
          '당신은 세계관 일관성 에이전트입니다.\n' +
          '지금 벌어지고 있는 사건과 직전 턴의 상황에 밀착하여, 현재 상호작용하고 있는 국소적인 세계관 요소들만 추출해 짧은 메모를 작성하세요.\n' +
          '아래 포맷을 유지하되, 확실한 정보가 없거나 이번 장면에 중요하지 않은 항목은 "(해당 없음)"으로 둡니다.\n\n' +
          '[현재 국소 환경]\n' +
          '- 지금 당장 캐릭터를 둘러싼 물리적 장소, 시간, 날씨, 즉각적인 분위기\n\n' +
          '[작동 중인 제약/규칙]\n' +
          '- 직전 행동이나 현재 벌어지는 사건에 실시간으로 개입하는 세계관의 한계, 마법, 기술, 사회적 제약\n\n' +
          '[유지되어야 할 연속성]\n' +
          '- 바로 앞선 상황에서 발생해 이번 응답에서도 계속 이어져야 하는 물리적/상황적 조건 (예: 쏟아진 물, 켜진 경보기 등)',
      },
      {
        id: 'agent-plot',
        row: 1,
        column: 0,
        name: '플롯 에이전트',
        modelPresetId: DEFAULT_MODEL_PRESET_ID,
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
        modelPresetId: DEFAULT_MODEL_PRESET_ID,
        systemPrompt:
          '당신은 등장인물 에이전트입니다.\n' +
          '직전 턴에 벌어진 사건이나 대화에 대한 캐릭터들의 즉각적인 심리와 비언어적 반응을 분석합니다. 사전 설정 요약이나 말투 지침은 제외하고, 오직 현재 이 순간의 내면과 행동에만 집중하세요.\n' +
          '아래 포맷을 유지하되, 확실한 정보가 없거나 중요하지 않은 항목은 "(해당 없음)"으로 둡니다.\n\n' +
          '[직전 상황에 대한 반응]\n' +
          '- 이름: 바로 앞선 사건이나 상대의 말에 대해 속으로 느끼는 순간적인 감정과 신체적 반응\n\n' +
          '[당면한 충동과 의도]\n' +
          '- 이름: 이번 턴에서 당장 취하고 싶은 행동, 혹은 들키지 않으려 필사적으로 숨기는 것\n\n' +
          '[비언어적 상호작용]\n' +
          '- 현재 시점에서의 무의식적인 거리감 변화, 시선 처리, 순간적인 스킨십 허용도\n\n' +
          '[순간적인 버릇]\n' +
          '- 이름: 현재의 스트레스나 감정 상태 때문에 무의식적으로 튀어나오는 행동 (입술 깨물기 등)\n\n' +
          '[이번 턴의 행동 제약]\n' +
          '- 이번 상황에서 해당 인물이 절대 취하지 않을 무리한 기행이나 넘지 않을 선',
      },
      {
        id: 'agent-dialogue',
        row: 3,
        column: 0,
        name: '대사 에이전트',
        modelPresetId: DEFAULT_MODEL_PRESET_ID,
        systemPrompt: DEFAULT_DIALOGUE_SYSTEM_PROMPT,
      },
    ];

    function createEmptyPipeline() {
      return {
        version: PIPELINE_CONFIG_VERSION,
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

    function cloneJson(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function parseMaybeJson(raw, fallback = null) {
      if (raw === null || raw === undefined || raw === '') return fallback;
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch (_) {
          return fallback;
        }
      }
      return raw;
    }

    function normalizeExtraBodyJson(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      return JSON.stringify(parseExtraBodyJson(raw), null, 2);
    }

    function normalizePresetExtraBodyJson(value, options = {}) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      try {
        return normalizeExtraBodyJson(raw);
      } catch (err) {
        if (options.strictExtraBody) throw err;
        if (options.debugLog) console.log(`Agents! preset extra JSON body ignored: ${err.message}`);
        return '';
      }
    }

    function parseExtraBodyJson(value) {
      const raw = String(value || '').trim();
      if (!raw) return null;

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`추가 JSON body 파싱 실패: ${err.message}`);
      }

      if (!isPlainObject(parsed)) {
        throw new Error('추가 JSON body는 JSON object여야 합니다.');
      }
      return parsed;
    }

    function deepMergeJson(base, extra) {
      const result = { ...base };
      Object.entries(extra || {}).forEach(([key, value]) => {
        if (key === 'messages') return;
        if (isPlainObject(value) && isPlainObject(result[key])) {
          result[key] = deepMergeJson(result[key], value);
        } else {
          result[key] = value;
        }
      });
      return result;
    }

    function isPlainObject(value) {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function createPipelinePreset(name, pipeline) {
      const now = new Date().toISOString();
      return {
        id: makeAgentId('pipeline'),
        name: String(name || '새 파이프라인'),
        createdAt: now,
        updatedAt: now,
        pipeline: cloneJson(pipeline || createEmptyPipeline()),
      };
    }

    function normalizePipelinePresetStore(raw, fallbackPipeline, modelPresets = null) {
      const parsed = parseMaybeJson(raw, null);
      const sourcePresets = Array.isArray(parsed?.presets) ? parsed.presets : [];
      const used = new Set();
      const presets = sourcePresets.map((preset, idx) => {
        const baseId = String(preset?.id || `pipeline-${idx + 1}`);
        let id = baseId;
        while (used.has(id)) id = `${baseId}-${used.size + 1}`;
        used.add(id);
        const createdAt = String(preset?.createdAt || new Date().toISOString());
        return {
          id,
          name: String(preset?.name || `Pipeline ${idx + 1}`),
          createdAt,
          updatedAt: String(preset?.updatedAt || createdAt),
          pipeline: normalizePipelineConfig(preset?.pipeline, modelPresets),
        };
      });

      if (presets.length === 0) {
        presets.push(createPipelinePreset('기본 파이프라인', normalizePipelineConfig(fallbackPipeline || defaultPipelineConfig(), modelPresets)));
      }

      const activePresetId = presets.some(preset => preset.id === parsed?.activePresetId)
        ? String(parsed.activePresetId)
        : presets[0].id;

      return {
        version: PIPELINE_PRESET_STORE_VERSION,
        activePresetId,
        presets,
      };
    }

    function getActivePipelinePreset(store) {
      return (store?.presets || []).find(preset => preset.id === store?.activePresetId) || store?.presets?.[0] || null;
    }

    async function getPipelinePresetStore(conf) {
      const legacyRaw = await Risuai.getArgument('agents_pipeline_json');
      let fallbackPipeline = defaultPipelineConfig();
      if (legacyRaw || conf?.pipeline) {
        try {
          fallbackPipeline = normalizePipelineConfig(legacyRaw ? JSON.parse(String(legacyRaw)) : conf.pipeline, conf?.modelPresets);
        } catch (err) {
          if (conf?.debugLog) console.log(`Agents! legacy pipeline JSON parse failed: ${err.message}`);
        }
      }

      try {
        const rawStore = await Risuai.pluginStorage.getItem(PIPELINE_PRESETS_STORAGE_KEY);
        const store = normalizePipelinePresetStore(rawStore || conf?.pipelinePresetStore, fallbackPipeline, conf?.modelPresets);
        if (!rawStore) {
          await Risuai.pluginStorage.setItem(PIPELINE_PRESETS_STORAGE_KEY, store);
        }
        return store;
      } catch (err) {
        if (conf?.debugLog) console.log(`Agents! pipeline preset store load failed: ${err.message}`);
        return normalizePipelinePresetStore(null, fallbackPipeline, conf?.modelPresets);
      }
    }

    async function savePipelinePresetStore(store, activePipeline, conf) {
      const normalizedStore = normalizePipelinePresetStore(store, activePipeline, conf?.modelPresets);
      const active = getActivePipelinePreset(normalizedStore);
      if (activePipeline && active) {
        active.pipeline = normalizePipelineConfig(activePipeline, conf?.modelPresets);
        active.updatedAt = new Date().toISOString();
      }
      await Risuai.pluginStorage.setItem(PIPELINE_PRESETS_STORAGE_KEY, normalizedStore);
      if (active) await Risuai.setArgument('agents_pipeline_json', JSON.stringify(active.pipeline));
      return normalizedStore;
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

      fallback.version = PIPELINE_CONFIG_VERSION;
      return fallback;
    }

    async function getPipelineConfig(conf) {
      const store = await getPipelinePresetStore(conf);
      return normalizePipelineConfig(getActivePipelinePreset(store)?.pipeline || defaultPipelineConfig(), conf?.modelPresets);
    }

    function normalizeAgent(agent, row, column, modelPresets = null) {
      const mode = row < MAIN_ROW_INDEX ? 'pre' : 'post';
      const modelPresetId = resolveAgentPresetId(agent, modelPresets);
      const postMode = mode === 'post' ? normalizePostMode(agent?.postMode) : POST_MODE_POLISH;
      const systemPrompt = normalizeAgentSystemPrompt(agent, mode);
      return {
        id: String(agent?.id || makeAgentId(mode)),
        name: String(agent?.name || (mode === 'pre' ? '새 노트 에이전트' : '새 후처리 에이전트')),
        enabled: agent?.enabled !== false,
        mode,
        row,
        column: Number.isFinite(Number(agent?.column)) ? Number(agent.column) : column,
        systemPrompt,
        outputInstruction: String(agent?.outputInstruction || (mode === 'pre' ? DEFAULT_OUTPUT_PRE : defaultOutputInstructionForPostMode(postMode))),
        modelPresetId,
        ...(mode === 'post' ? { postMode } : {}),
        includeSettingBlocks: agent?.includeSettingBlocks !== undefined
          ? agent.includeSettingBlocks !== false
          : agent?.includeCuratedContext !== false,
        includeHistory: agent?.includeHistory !== false,
        includeUserInput: agent?.includeUserInput !== false,
        includePreviousNotes: agent?.includePreviousNotes !== false,
        includeGlobalNoteReplacement: agent?.includeGlobalNoteReplacement === true,
        memoryEnabled: mode === 'pre' && agent?.memoryEnabled === true,
        memoryInstruction: String(agent?.memoryInstruction || ''),
        memoryFormat: String(agent?.memoryFormat || ''),
      };
    }

    function normalizeAgentSystemPrompt(agent, mode) {
      const systemPrompt = String(agent?.systemPrompt || defaultSystemPromptForMode(mode));
      if (agent?.id === 'agent-dialogue' && systemPrompt === LEGACY_DEFAULT_DIALOGUE_SYSTEM_PROMPT) {
        return DEFAULT_DIALOGUE_SYSTEM_PROMPT;
      }
      return systemPrompt;
    }

    function normalizePostMode(value) {
      const mode = String(value || POST_MODE_POLISH);
      return POST_MODES.includes(mode) ? mode : POST_MODE_POLISH;
    }

    function defaultOutputInstructionForPostMode(postMode) {
      switch (normalizePostMode(postMode)) {
        case POST_MODE_PREFIX:
          return DEFAULT_OUTPUT_POST_PREFIX;
        case POST_MODE_SUFFIX:
          return DEFAULT_OUTPUT_POST_SUFFIX;
        case POST_MODE_POLISH:
        default:
          return DEFAULT_OUTPUT_POST_POLISH;
      }
    }

    function isDefaultPostOutputInstruction(value) {
      const text = String(value || '').trim();
      return !text || [
        DEFAULT_OUTPUT_POST_POLISH,
        DEFAULT_OUTPUT_POST_PREFIX,
        DEFAULT_OUTPUT_POST_SUFFIX,
        DEFAULT_OUTPUT_POST,
      ].some(item => text === item);
    }

    function postModeLabel(postMode) {
      switch (normalizePostMode(postMode)) {
        case POST_MODE_PREFIX:
          return '앞에 추가';
        case POST_MODE_SUFFIX:
          return '뒤에 추가';
        case POST_MODE_POLISH:
        default:
          return '전체 다듬기';
      }
    }

    function resolveAgentPresetId(agent, modelPresets) {
      const presets = Array.isArray(modelPresets) ? modelPresets : [];
      const id = String(agent?.modelPresetId || UNSET_MODEL_PRESET_ID);
      if (!id) return UNSET_MODEL_PRESET_ID;
      if (presets.length === 0 || presets.some(preset => preset.id === id)) return id;
      return UNSET_MODEL_PRESET_ID;
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
      if (!preset) return null;
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
        reasoningQuickSetting: normalizeReasoningQuickSetting(provider, preset.reasoningQuickSetting),
        presetExtraBodyJson: preset.extraBodyJson || '',
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
        if (!preset) return false;
        return Boolean(getProviderApiKey(conf.providerKeys, preset.provider));
      });
    }

    function hasMissingModelPresetForRows(pipeline, conf, startRow, endRow) {
      for (let row = startRow; row <= endRow; row += 1) {
        if (getEnabledAgentsForRow(pipeline, row).some(agent => !findModelPreset(conf.modelPresets, agent.modelPresetId))) {
          return true;
        }
      }
      return false;
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
      if (agent.includeGlobalNoteReplacement && context.globalNoteReplacement) {
        sections.push(`[글로벌 노트 덮어쓰기]\n${context.globalNoteReplacement}`);
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
          ? postModeOutputContract(agent.postMode)
          : '최종 RP 응답은 작성하지 말고 보조 메모만 작성하세요.',
        agent.mode === 'pre' && agent.memoryEnabled ? `\n${memoryOutputContract(agent)}` : '',
      ].join('\n');

      return [
        { role: 'system', content: systemContent },
        { role: 'user', content: sections.join('\n\n') },
      ];
    }

    function postModeOutputContract(postMode) {
      switch (normalizePostMode(postMode)) {
        case POST_MODE_PREFIX:
          return [
            '반드시 현재 응답 앞에 붙일 추가 텍스트 조각만 출력하세요.',
            '현재 응답 본문을 반복하거나 다시 쓰지 마세요.',
            '분석 메모, 설명, 변경 목록, 접두사는 출력하지 마세요.',
          ].join('\n');
        case POST_MODE_SUFFIX:
          return [
            '반드시 현재 응답 뒤에 붙일 추가 텍스트 조각만 출력하세요.',
            '현재 응답 본문을 반복하거나 다시 쓰지 마세요.',
            '분석 메모, 설명, 변경 목록, 접두사는 출력하지 마세요.',
          ].join('\n');
        case POST_MODE_POLISH:
        default:
          return '반드시 최종 사용자에게 보여줄 수정 응답 전체만 출력하세요. 분석 메모, 설명, 변경 목록을 출력하지 마세요.';
      }
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

    function agentMemoryBaseKey(agent, scope) {
      if (!scope?.chatKey) return '';
      return `${'risu_agents_' + 'memory_v4:'}${scope?.characterId || 'unknown-character'}:${scope.chatKey}:${sanitizeMemoryKeyPart(agent.id)}`;
    }

    function agentMemoryKey(agent, scope) {
      const baseKey = agentMemoryBaseKey(agent, scope);
      return baseKey ? `${baseKey}:index` : '';
    }

    function agentMemorySnapshotKey(indexKey, messageCount) {
      const baseKey = String(indexKey || '').replace(/:index$/, '');
      if (!baseKey) return '';
      return `${baseKey}:snapshot:${sanitizeMemoryKeyPart(messageCount)}`;
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
      if (!snapshot || typeof snapshot !== 'object') return null;
      const state = fallbackState || {};
      const messageCount = Number.isFinite(Number(snapshot?.messageCount))
        ? Math.max(0, parseInt(snapshot.messageCount, 10) || 0)
        : Number.isFinite(Number(state.messageCount))
          ? Math.max(0, parseInt(state.messageCount, 10) || 0)
          : 0;
      const snapshotKey = String(snapshot?.snapshotKey || state.snapshotKey || '').trim();
      if (!snapshotKey) return null;
      return {
        messageCount,
        snapshotKey,
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

      return base;
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

    async function loadMemorySnapshotValue(snapshot, debugLog) {
      if (!snapshot?.snapshotKey) return '';
      try {
        const raw = await Risuai.pluginStorage.getItem(snapshot.snapshotKey);
        const value = raw && typeof raw === 'object' && raw !== null
          ? String(raw.value || '').trim()
          : String(raw || '').trim();
        return value;
      } catch (err) {
        if (debugLog) console.log(`Agents! memory snapshot load failed: ${err.message}`);
        return '';
      }
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
        const value = await loadMemorySnapshotValue(snapshot, debugLog);
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
        const value = await loadMemorySnapshotValue(snapshot, debugLog);
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
        const snapshotKey = agentMemorySnapshotKey(memory.key, state.messageCount);
        if (!snapshotKey) return false;
        const snapshot = {
          messageCount: state.messageCount,
          preview: state.preview,
          snapshotKey,
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
        await Risuai.pluginStorage.setItem(snapshotKey, {
          version: MEMORY_STACK_VERSION,
          messageCount: state.messageCount,
          value: nextMemory,
          updatedAt: now,
        });
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
        postMode: agent.mode === 'post' ? normalizePostMode(agent.postMode) : '',
      };
    }

    function isRunLogEnabled(conf) {
      return conf?.runLogEnabled === true;
    }

    function createRunLogBase(type, pipeline, conf, scope, status = 'running', reason = '') {
      const keepRunDetails = isRunLogEnabled(conf);
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
        pipelineSnapshot: keepRunDetails
          ? JSON.parse(JSON.stringify(pipeline || createEmptyPipeline()))
          : createEmptyPipeline(),
        preResults: [],
        postResults: [],
        notes: [],
        userInput: '',
        settingBlocks: '',
        settingBlockStats: null,
        globalNoteReplacement: '',
        cbsContextHash: '',
        cbsWarnings: [],
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
        firstMessageIncluded: Boolean(chatContext?.firstMessageIncluded),
        firstMessageSource: chatContext?.firstMessageSource || '',
        firstMessageIndex: chatContext?.firstMessageIndex ?? null,
        firstMessageError: chatContext?.firstMessageError || '',
        placeholderReplacementApplied: Boolean(chatContext?.placeholderReplacementApplied),
        placeholderUserSource: chatContext?.placeholderUserSource || '',
      };
    }

    function buildPreReuseKey(scope, chatContext, settingBlocks, pipeline, conf, cbsContext = null, globalNoteReplacement = '') {
      if (chatContext?.available !== true || !scope?.chatKey) return '';
      const contextMessages = Array.isArray(chatContext.messages) ? chatContext.messages : [];
      const messageCount = chatContext.messageCount ?? contextMessages.length;
      const maxHistoryWindow = maxPreAgentHistoryWindow(pipeline, conf);
      const currentUserHash = hashCurrentUserMessage(contextMessages);
      const recentHistoryHash = hashRecentMessages(contextMessages, maxHistoryWindow);
      const settingBlocksHash = hashTextBlock(settingBlocks?.content || '');
      const globalNoteReplacementHash = hashTextBlock(globalNoteReplacement || '');
      const preAgentsHash = hashPreAgentConfig(pipeline, conf);
      const cbsContextHash = hashAgentCbsContext(cbsContext);
      const keyHash = createTextHasher()
        .update('version').update(PRE_REUSE_VERSION)
        .update('chatKey').update(scope.chatKey)
        .update('messageCount').update(messageCount)
        .update('currentUserHash').update(currentUserHash)
        .update('recentHistoryHash').update(recentHistoryHash)
        .update('settingBlocksHash').update(settingBlocksHash)
        .update('globalNoteReplacementHash').update(globalNoteReplacementHash)
        .update('cbsContextHash').update(cbsContextHash)
        .update('preAgentsHash').update(preAgentsHash)
        .digest();
      return `v${PRE_REUSE_VERSION}:${keyHash}:${messageCount}:${maxHistoryWindow}`;
    }

    function createTextHasher() {
      let hash = 2166136261;
      let length = 0;
      return {
        update(value) {
          const text = String(value ?? '');
          for (let idx = 0; idx < text.length; idx += 1) {
            hash ^= text.charCodeAt(idx);
            hash = Math.imul(hash, 16777619);
          }
          hash ^= 31;
          hash = Math.imul(hash, 16777619);
          length += text.length + 1;
          return this;
        },
        digest() {
          return `${(hash >>> 0).toString(16).padStart(8, '0')}:${length}`;
        },
      };
    }

    function hashTextBlock(text) {
      return createTextHasher().update(text).digest();
    }

    function hashCurrentUserMessage(messages) {
      for (let idx = (Array.isArray(messages) ? messages.length : 0) - 1; idx >= 0; idx -= 1) {
        if (messages[idx]?.role === 'user') {
          return createTextHasher()
            .update('user')
            .update(messages[idx].content || '')
            .digest();
        }
      }
      return hashTextBlock('');
    }

    function hashRecentMessages(messages, windowSize) {
      const hasher = createTextHasher().update('recentMessages').update(windowSize);
      const chatMsgs = (Array.isArray(messages) ? messages : []).filter(m => m.role === 'user' || m.role === 'assistant');
      const recent = windowSize > 0 ? chatMsgs.slice(-(windowSize + 1), -1) : [];
      hasher.update(recent.length);
      recent.forEach((msg) => {
        hasher.update(msg.role).update(msg.content || '');
      });
      return hasher.digest();
    }

    function maxPreAgentHistoryWindow(pipeline, conf) {
      let maxWindow = 0;
      for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
        getEnabledAgentsForRow(pipeline, row).forEach((agent) => {
          if (!agent.includeHistory) return;
          const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
          const window = Math.max(1, parseInt(preset?.contextWindow || conf.window, 10) || conf.window || 10);
          maxWindow = Math.max(maxWindow, window);
        });
      }
      return maxWindow;
    }

    function maxPreAgentContextWindow(pipeline, conf) {
      let maxWindow = 0;
      for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
        getEnabledAgentsForRow(pipeline, row).forEach((agent) => {
          const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
          const window = Math.max(1, parseInt(preset?.contextWindow || conf.window, 10) || conf.window || 10);
          maxWindow = Math.max(maxWindow, window);
        });
      }
      return maxWindow;
    }

    function hashPreAgentConfig(pipeline, conf) {
      const hasher = createTextHasher().update('preAgents');
      for (let row = 0; row < MAIN_ROW_INDEX; row += 1) {
        const agents = getEnabledAgentsForRow(pipeline, row);
        hasher.update('row').update(row).update('count').update(agents.length);
        agents.forEach((agent) => {
          const preset = findModelPreset(conf.modelPresets, agent.modelPresetId);
          hasher
            .update(agent.id)
            .update(agent.row)
            .update(agent.column)
            .update(agent.enabled !== false)
            .update(agent.modelPresetId)
            .update(agent.systemPrompt || '')
            .update(agent.outputInstruction || '')
            .update(Boolean(agent.includeSettingBlocks))
            .update(Boolean(agent.includeHistory))
            .update(Boolean(agent.includeUserInput))
            .update(Boolean(agent.includePreviousNotes))
            .update(Boolean(agent.includeGlobalNoteReplacement))
            .update(Boolean(agent.mode === 'pre' && agent.memoryEnabled))
            .update(agent.memoryInstruction || '')
            .update(agent.memoryFormat || '')
            .update(preset?.provider || '')
            .update(preset?.model || '')
            .update(preset?.baseUrl || '')
            .update(String(preset?.temperature ?? ''))
            .update(String(preset?.maxTokens ?? ''))
            .update(String(preset?.contextWindow ?? ''))
            .update(String(preset?.reasoningQuickSetting ?? ''))
            .update(String(preset?.extraBodyJson ?? ''));
        });
      }
      return hasher.digest();
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

    function createPreReusedRunLog(type, pipeline, conf, scope, chatContext, settingBlocks, previousRun, preReuseKey, globalNoteReplacement = '') {
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
        globalNoteReplacement,
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

    async function persistRunLog(run, debugLog, runLogEnabled = true) {
      if (runLogEnabled === false) {
        if (debugLog) console.log('Agents! run log save skipped: run log disabled');
        return false;
      }
      if (!run?.runKey) {
        if (debugLog) console.log('Agents! run log save skipped: chat scope unavailable');
        return false;
      }
      try {
        run.updatedAt = Date.now();
        const compactedRun = await compactRunLogForStorage(run, debugLog);
        await Risuai.pluginStorage.setItem(run.runKey, compactedRun);
        if (debugLog) console.log(`Agents! run log saved: ${run.runKey}`);
        return true;
      } catch (err) {
        if (debugLog) console.log(`Agents! run log save failed: ${err.message}`);
        return false;
      }
    }

    async function compactRunLogForStorage(run, debugLog) {
      const compacted = {
        ...run,
        preResults: Array.isArray(run.preResults) ? run.preResults.map(result => ({ ...result })) : [],
        postResults: Array.isArray(run.postResults) ? run.postResults.map(result => ({ ...result })) : [],
        notes: Array.isArray(run.notes) ? run.notes.map(note => ({ ...note })) : [],
      };
      delete compacted.cbsContext;
      const updatedAt = run.updatedAt || Date.now();

      await compactRunLogTextField(compacted, 'settingBlocks', run, 'settingBlocks', updatedAt, debugLog);
      await compactRunLogTextField(compacted, 'finalResponse', run, 'finalResponse', updatedAt, debugLog);

      for (let idx = 0; idx < compacted.preResults.length; idx += 1) {
        const result = compacted.preResults[idx];
        await compactRunLogTextField(result, 'content', run, `preResults.${idx}.content`, updatedAt, debugLog);
        await compactRunLogTextField(result, 'rawOutput', run, `preResults.${idx}.rawOutput`, updatedAt, debugLog);
        await compactRunLogTextField(result, 'prompt', run, `preResults.${idx}.prompt`, updatedAt, debugLog);
        await compactRunLogTextField(result, 'memoryPrevious', run, `preResults.${idx}.memoryPrevious`, updatedAt, debugLog);
        await compactRunLogTextField(result, 'memoryUpdate', run, `preResults.${idx}.memoryUpdate`, updatedAt, debugLog);
      }

      for (let idx = 0; idx < compacted.postResults.length; idx += 1) {
        const result = compacted.postResults[idx];
        await compactRunLogTextField(result, 'inputResponse', run, `postResults.${idx}.inputResponse`, updatedAt, debugLog);
        await compactRunLogTextField(result, 'outputResponse', run, `postResults.${idx}.outputResponse`, updatedAt, debugLog);
        await compactRunLogTextField(result, 'rawOutput', run, `postResults.${idx}.rawOutput`, updatedAt, debugLog);
        await compactRunLogTextField(result, 'prompt', run, `postResults.${idx}.prompt`, updatedAt, debugLog);
      }

      return compacted;
    }

    async function compactRunLogTextField(holder, field, run, fieldPath, updatedAt, debugLog) {
      if (!holder || holder[field] === undefined || holder[field] === null) return;
      const value = String(holder[field]);
      if (value.length < RUN_LOG_BODY_INLINE_LIMIT) return;

      const bodyKey = runLogBodyKey(run, fieldPath);
      if (!bodyKey) return;

      await Risuai.pluginStorage.setItem(bodyKey, {
        version: RUN_LOG_BODY_VERSION,
        runKey: run.runKey,
        fieldPath,
        value,
        chars: value.length,
        updatedAt,
      });
      delete holder[field];
      holder[`${field}Preview`] = value.slice(0, RUN_LOG_BODY_PREVIEW_CHARS);
      holder[`${field}Chars`] = value.length;
      holder[`${field}BodyKey`] = bodyKey;
      if (debugLog) console.log(`Agents! run log body saved: ${fieldPath} (${value.length} chars)`);
    }

    function runLogBodyKey(run, fieldPath) {
      if (!run?.chatKey) return '';
      return `${'risu_agents_' + 'run_body_v'}${RUN_LOG_BODY_VERSION}:${run.characterId || 'unknown-character'}:${run.chatKey}:${sanitizeMemoryKeyPart(fieldPath)}`;
    }

    async function loadRunLogBodyValue(bodyKey, debugLog) {
      if (!bodyKey) return '';
      try {
        const raw = await Risuai.pluginStorage.getItem(bodyKey);
        return raw && typeof raw === 'object' && raw !== null
          ? String(raw.value || '')
          : String(raw || '');
      } catch (err) {
        if (debugLog) console.log(`Agents! run log body load failed: ${err.message}`);
        return '';
      }
    }

    async function loadCurrentRunLog(debugLog, runLogEnabled = true) {
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
          runLogEnabled,
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
            runLogEnabled,
            runLogStale: runLogEnabled === false,
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
          runLogEnabled,
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
          runLogEnabled,
        };
      }
    }

    async function runPrePipeline(_requestMessages, chatContext, conf, pipeline, settingBlocks, type, runScope, preReuseKey = '', runContext = null) {
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
      const keepRunDetails = isRunLogEnabled(conf);
      const cbsContext = runContext?.cbsContext || null;
      const cbsContextHash = hashAgentCbsContext(cbsContext);
      const globalNoteReplacement = String(runContext?.globalNoteReplacement || '').trim();
      const runCbsWarnings = [];
      const notes = [];
      const userInput = getUserInput(contextMessages);
      const preResults = [];

      if (chatContext?.available !== true) {
        const skipText = `(스킵: 실제 채팅방 대화 컨텍스트 없음 - ${memoryUnavailableReason})`;
        if (keepRunDetails) {
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
          pipelineSnapshot: keepRunDetails ? JSON.parse(JSON.stringify(pipeline)) : createEmptyPipeline(),
          settingBlocks: settingBlocks.content,
          settingBlockStats: settingBlocks.stats,
          globalNoteReplacement,
          cbsContext,
          cbsContextHash,
          cbsWarnings: [],
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
          if (!agentConf) {
            const content = '(스킵: 모델 프리셋 미설정)';
            console.log(`Agents! pre-agent skipped (${agent.name}): model preset not set`);
            return {
              ...runAgentMeta(agent, conf),
              content,
              ...(keepRunDetails ? { rawOutput: content } : {}),
              status: 'skipped',
              failed: true,
              error: '모델 프리셋 미설정',
              memoryStatus: agent.memoryEnabled ? 'skipped' : 'disabled',
            };
          }
          if (!agentConf.apiKey) {
            const content = `(실패: ${agentConf.provider} provider API key 없음)`;
            console.log(`Agents! pre-agent skipped (${agent.name}): ${agentConf.provider} provider API key not set`);
            return {
              ...runAgentMeta(agent, conf),
              content,
              ...(keepRunDetails ? { rawOutput: content } : {}),
              status: 'skipped',
              failed: true,
              memoryStatus: agent.memoryEnabled ? 'skipped' : 'disabled',
            };
          }
          const history = runContext?.historyForWindow
            ? runContext.historyForWindow(agentConf.window)
            : formatHistory(contextMessages, agentConf.window);
          const agentMemory = memoryCanWrite
            ? await loadAgentMemory(agent, memoryScope, contextMessages, conf.debugLog)
            : await loadAgentMemoryReadOnly(agent, memoryScope, conf.debugLog, memoryUnavailableReason);
          const rawPrompt = buildAgentPrompt(agent, {
            settingBlocks: settingBlocks.content,
            globalNoteReplacement,
            history,
            userInput,
            notes,
            agentMemory: agentMemory.value || EMPTY_AGENT_MEMORY,
          });
          const cbsRender = renderAgentCbsMessages(rawPrompt, cbsContext, {
            debugLog: conf.debugLog,
            label: `Row ${row + 1} ${agent.name}`,
          });
          const prompt = cbsRender.messages;
          runCbsWarnings.push(...cbsRender.warnings);
          const promptLogFields = keepRunDetails
            ? {
              prompt: formatPromptForRunLog(prompt),
              cbsWarnings: cbsRender.warnings,
              cbsApplied: cbsRender.applied,
            }
            : {};

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
                  ...(keepRunDetails ? {
                    rawOutput: content,
                    ...promptLogFields,
                    memoryPrevious: agentMemory.value || '',
                    memoryUpdate: parsed.memoryUpdate,
                  } : {}),
                  status: 'success',
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
                ...(keepRunDetails ? {
                  rawOutput: content,
                  ...promptLogFields,
                  memoryPrevious: agentMemory.value || '',
                  memoryUpdate: '',
                } : {}),
                status: 'success',
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
              ...(keepRunDetails ? { rawOutput: content, ...promptLogFields } : {}),
              status: 'success',
              memoryStatus: 'disabled',
            };
          } catch (err) {
            const content = `(실패: ${err.message})`;
            console.log(`Agents! pre-agent failed (${agent.name}): ${err.message}`);
            return {
              ...runAgentMeta(agent, conf),
              content,
              ...(keepRunDetails ? { rawOutput: content, ...promptLogFields } : {}),
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
        if (keepRunDetails) preResults.push(...sortedResults);
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
        pipelineSnapshot: keepRunDetails ? JSON.parse(JSON.stringify(pipeline)) : createEmptyPipeline(),
        settingBlocks: settingBlocks.content,
        settingBlockStats: settingBlocks.stats,
        globalNoteReplacement,
        cbsContext,
        cbsContextHash,
        cbsWarnings: mergeAgentCbsWarnings(runCbsWarnings),
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
      const keepRunDetails = isRunLogEnabled(conf);
      const previousRun = lastPipelineRun || {
        type,
        postResults: [],
        settingBlocks: formatSettingBlocks({
          characterDescription: '(캐릭터 설명 없음)',
          userDescription: '(유저 설명 없음)',
          authorNote: '(작가의 노트 없음)',
          activeLorebooks: [],
        }),
        globalNoteReplacement: '',
        notes: [],
      };
      const postResults = Array.isArray(previousRun.postResults) ? previousRun.postResults : [];
      const cbsContext = previousRun.cbsContext || lastPipelineRun?.cbsContext || null;
      const cbsContextHash = hashAgentCbsContext(cbsContext);
      const runCbsWarnings = Array.isArray(previousRun.cbsWarnings) ? previousRun.cbsWarnings.slice() : [];

      for (let row = MAIN_ROW_INDEX + 1; row < PIPELINE_ROW_COUNT; row += 1) {
        const agent = getEnabledAgentsForRow(pipeline, row)[0];
        if (!agent) continue;

        const agentConf = resolveAgentConfig(agent, conf);
        if (!agentConf) {
          console.log(`Agents! post-agent skipped (${agent.name}): model preset not set`);
          if (keepRunDetails) {
            postResults.push({
              ...runAgentMeta(agent, conf),
              status: 'skipped',
              failed: true,
              inputResponse: currentResponse,
              outputResponse: currentResponse,
              error: '모델 프리셋 미설정',
            });
          }
          continue;
        }
        if (!agentConf.apiKey) {
          console.log(`Agents! post-agent skipped (${agent.name}): ${agentConf.provider} provider API key not set`);
          if (keepRunDetails) {
            postResults.push({
              ...runAgentMeta(agent, conf),
              status: 'skipped',
              failed: true,
              inputResponse: currentResponse,
              outputResponse: currentResponse,
              error: `${agentConf.provider} provider API key 없음`,
            });
          }
          continue;
        }
        const rawPrompt = buildAgentPrompt(agent, {
          settingBlocks: previousRun.settingBlocks,
          globalNoteReplacement: previousRun.globalNoteReplacement || '',
          notes: previousRun.notes,
          currentResponse,
        });
        const cbsRender = renderAgentCbsMessages(rawPrompt, cbsContext, {
          debugLog: conf.debugLog,
          label: `Row ${row + 1} ${agent.name} post-agent`,
        });
        const prompt = cbsRender.messages;
        runCbsWarnings.push(...cbsRender.warnings);
        const promptLogFields = keepRunDetails
          ? {
            prompt: formatPromptForRunLog(prompt),
            cbsWarnings: cbsRender.warnings,
            cbsApplied: cbsRender.applied,
          }
          : {};

        if (conf.debugLog) logPromptFlow(`Agents! debug: Row ${row + 1} ${agent.name} post-agent prompt`, prompt, true);

        try {
          const rawOutput = String(await callAgent(agentConf, prompt) || '').trim();
          if (rawOutput) {
            const nextResponse = applyPostAgentOutput(agent, currentResponse, rawOutput);
            if (keepRunDetails) {
              postResults.push({
                ...runAgentMeta(agent, conf),
                status: 'success',
                inputResponse: currentResponse,
                outputResponse: nextResponse,
                rawOutput,
                ...promptLogFields,
              });
            }
            currentResponse = nextResponse;
            if (conf.debugLog) logTextBlock(`Agents! debug: Row ${row + 1} ${agent.name} post-agent result`, currentResponse);
          } else {
            console.log(`Agents! post-agent returned empty response (${agent.name}); keeping previous response`);
            if (keepRunDetails) {
              postResults.push({
                ...runAgentMeta(agent, conf),
                status: 'empty',
                inputResponse: currentResponse,
                outputResponse: currentResponse,
                rawOutput: '',
                ...promptLogFields,
              });
            }
          }
        } catch (err) {
          console.log(`Agents! post-agent failed (${agent.name}): ${err.message}`);
          if (keepRunDetails) {
            postResults.push({
              ...runAgentMeta(agent, conf),
              status: 'failed',
              failed: true,
              inputResponse: currentResponse,
              outputResponse: currentResponse,
              ...promptLogFields,
              error: err.message,
            });
          }
        }
      }

      if (lastPipelineRun) {
        lastPipelineRun.postResults = postResults;
        lastPipelineRun.status = lastPipelineRun.preReused ? 'pre-reused' : 'complete';
        lastPipelineRun.cbsContext = cbsContext;
        lastPipelineRun.cbsContextHash = cbsContextHash;
        lastPipelineRun.cbsWarnings = mergeAgentCbsWarnings(runCbsWarnings);
        if (keepRunDetails) lastPipelineRun.finalResponse = currentResponse;
      }

      return currentResponse;
    }

    function applyPostAgentOutput(agent, currentResponse, rawOutput) {
      const current = String(currentResponse ?? '');
      const output = String(rawOutput ?? '').trim();
      switch (normalizePostMode(agent?.postMode)) {
        case POST_MODE_PREFIX:
          return joinResponseParts(output, current);
        case POST_MODE_SUFFIX:
          return joinResponseParts(current, output);
        case POST_MODE_POLISH:
        default:
          return output;
      }
    }

    function joinResponseParts(first, second) {
      const left = String(first ?? '').trim();
      const right = String(second ?? '').trim();
      if (!left) return right;
      if (!right) return left;
      return `${left}\n\n${right}`;
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
      const pipelineStore = await getPipelinePresetStore(conf);
      const pipeline = normalizePipelineConfig(getActivePipelinePreset(pipelineStore)?.pipeline || defaultPipelineConfig(), conf.modelPresets);
      document.body.innerHTML = buildLiteUI(conf, pipeline, pipelineStore);
      setupLiteHandlers(conf, pipeline, pipelineStore);
      await Risuai.showContainer('fullscreen');
    }

    async function openRunInspector() {
      console.log('Agents! opening run inspector');
      const conf = await getConfig();
      const pipeline = await getPipelineConfig(conf);
      const runLog = await loadCurrentRunLog(conf.debugLog, conf.runLogEnabled);
      document.body.innerHTML = buildRunInspectorUI(pipeline, runLog);
      setupRunInspectorHandlers(conf, pipeline, runLog);
      await Risuai.showContainer('fullscreen');
    }

    const menuIcon = '🧠';

    await registerLiteUIEntrypoints();

    async function registerLiteUIEntrypoints() {
      await unregisterKnownUIPart(SETTINGS_UI_ID);
      await unregisterKnownUIPart(HAMBURGER_UI_ID);
      await unregisterKnownUIPart(CHAT_UI_ID);
      await Promise.all(LEGACY_UI_IDS.map(id => unregisterKnownUIPart(id)));

      try {
        const setting = await Risuai.registerSetting('Agents! 설정', openLiteDashboard, menuIcon, 'html', SETTINGS_UI_ID);
        console.log('Agents! setting registered', setting?.id || setting || '');
      } catch (err) {
        console.log(`Agents! setting registration failed: ${err.message}`);
      }

      try {
        const button = await Risuai.registerButton({
          name: 'Agents! Run Inspector',
          icon: menuIcon,
          iconType: 'html',
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
          iconType: 'html',
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

    function youtubeThemeStyles() {
      return `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  color-scheme:dark;
  --bg:#0f0f0f;
  --surface:#181818;
  --surface-2:#212121;
  --surface-3:#2a2a2a;
  --line:#303030;
  --line-strong:#3f3f3f;
  --text:#f1f1f1;
  --muted:#aaa;
  --muted-2:#717171;
  --red:#ff0033;
  --red-hover:#e6002d;
  --red-soft:rgba(255,0,51,.14);
  --blue:#3ea6ff;
  --green:#2ba640;
  --danger:#ff5d5d;
}
body{font-family:Roboto,Arial,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.45}
.wrap{max-width:1240px;margin:0 auto;padding:24px 20px 104px}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:18px;margin:-24px -20px 18px;padding:14px 20px;background:rgba(15,15,15,.96);border-bottom:1px solid var(--line);backdrop-filter:blur(16px)}
.top>div:first-child{min-width:0}
h1{font-size:1.22rem;font-weight:800;letter-spacing:0;margin-bottom:2px;display:flex;align-items:center;gap:10px}
h1::before{content:"";width:32px;height:22px;border-radius:6px;background:var(--red);box-shadow:0 0 0 1px rgba(255,255,255,.06) inset,13px 6px 0 -4px #fff;display:inline-block;flex:0 0 auto}
.subtitle{color:var(--muted);font-size:.82rem;max-width:720px}
.header-actions{display:flex;justify-content:flex-end}
.top-tabs{display:inline-flex;align-items:center;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface-2);overflow:hidden}
.top-tabs button{border:0;border-radius:0;background:transparent;min-height:42px;padding:9px 16px}
.top-tabs button+button{border-left:1px solid var(--line)}
.top-tabs button.primary{background:var(--red);color:#fff}
.top-tabs button.ghost{color:#f1f1f1}
.top-tabs button:hover{background:var(--surface-3)}
.top-tabs button.primary:hover{background:var(--red-hover)}
.status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
.metric,.card,.test-result,.memory-snapshot,.preset-item,.agent-card,.pipeline-row{background:var(--surface);border:1px solid var(--line);border-radius:8px}
.metric{padding:13px;min-height:72px}
.metric-label{font-size:.72rem;color:var(--muted-2);margin-bottom:5px}
.metric-value{font-size:.92rem;font-weight:700;overflow-wrap:anywhere}
.metric-sub{font-size:.74rem;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card{padding:16px;margin-bottom:14px}
.card h2{font-size:.93rem;margin-bottom:12px;color:var(--text);font-weight:800}
.card p{font-size:.82rem;color:var(--muted)}
.run-log-control-row{display:flex;justify-content:flex-start;margin:-4px 0 14px}
.run-log-control-row button{box-shadow:0 1px 0 rgba(255,255,255,.06) inset}
.collapsible-card summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none}
.collapsible-card summary::-webkit-details-marker{display:none}
.collapsible-card summary h2{margin-bottom:0}
.collapsible-card .collapse-state{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.collapsible-card .collapse-state::before{content:"";width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--red)}
.collapsible-card[open] .collapse-state::before{border-top:0;border-bottom:8px solid var(--red)}
.collapsible-body{margin-top:12px}
.kv{display:grid;grid-template-columns:112px minmax(0,1fr);gap:7px 10px;font-size:.8rem}
.k{color:var(--muted-2)}.v{color:#e6e6e6;overflow-wrap:anywhere}
.field{margin-bottom:11px}
label{display:block;font-size:.75rem;color:var(--muted);margin-bottom:5px}
input,select,textarea{width:100%;padding:10px 11px;border-radius:6px;border:1px solid var(--line-strong);background:#121212;color:var(--text);font-size:.86rem}
textarea{min-height:96px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 2px rgba(62,166,255,.18)}
.model-custom-input{display:none;margin-top:8px}
.model-custom-active .model-custom-input{display:block}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.example-url{font-size:.73rem;color:var(--muted);background:#121212;border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:-3px 0 10px;overflow-wrap:anywhere}
.msg{font-size:.82rem;padding:10px 12px;border-radius:8px;margin-bottom:12px;display:none}
.msg.ok{display:block;background:rgba(43,166,64,.16);color:#83e79b;border:1px solid rgba(43,166,64,.55)}
.msg.err{display:block;background:rgba(255,93,93,.14);color:#ff9b9b;border:1px solid rgba(255,93,93,.5)}
.badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:.72rem;font-weight:700;border:1px solid transparent}
.badge.ok{background:rgba(43,166,64,.18);color:#83e79b;border-color:rgba(43,166,64,.42)}
.badge.err{background:rgba(255,93,93,.14);color:#ff9b9b;border-color:rgba(255,93,93,.42)}
.badge.neutral{background:var(--surface-2);color:#d7d7d7;border-color:var(--line)}
.error-text{color:#ff9b9b;overflow-wrap:anywhere}
.help-list{display:grid;gap:9px;font-size:.84rem;color:#cfcfcf}.help-list li{margin-left:18px}
.pipeline-shell,.inspector-shell{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(340px,.6fr);gap:14px;align-items:start}
.pipeline-preset-controls{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:12px;align-items:end;margin-bottom:12px}
.pipeline-preset-field{margin-bottom:0}
.pipeline-preset-controls select{height:49px}
.pipeline-preset-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding-bottom:0}
.pipeline-preset-actions button{border-radius:8px;height:49px;display:inline-flex;align-items:center;justify-content:center}
.file-input-hidden{display:none}
.pipeline-rows,.memory-stack,.preset-list{display:grid;gap:10px}
.pipeline-row{display:grid;grid-template-columns:92px minmax(0,1fr) 38px;gap:10px;align-items:center;padding:10px}
.pipeline-row.main{grid-template-columns:92px minmax(0,1fr);position:relative}
.pipeline-row.empty-row{position:relative}
.pipeline-row.post-filled{grid-template-columns:92px minmax(0,1fr);position:relative;min-height:60px}
.inspector-shell .pipeline-row{grid-template-columns:92px minmax(0,1fr)}
.inspector-shell .pipeline-row.post-filled{grid-template-columns:92px minmax(0,1fr)}
.pipeline-row.main{border-color:#555;background:#1f1f1f}
.row-label{font-size:.77rem;color:#e8e8e8;font-weight:800}.row-kind{font-size:.68rem;color:var(--muted-2);margin-top:2px}
.agent-lane{display:flex;gap:8px;flex-wrap:wrap;min-height:38px;align-items:center}
.post-agent-lane{justify-content:center}
.pipeline-row.post-filled .post-agent-lane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(240px,calc(100% - 132px))}
.pipeline-row.post-filled .agent-card{max-width:100%;width:100%}
.pipeline-empty-label{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:calc(100% - 160px);text-align:center;white-space:nowrap;pointer-events:none}
.agent-card{padding:9px 11px;min-width:152px;max-width:240px;cursor:pointer;transition:border-color .14s ease,background .14s ease,transform .14s ease}
.agent-card:hover,.agent-card.selected,.preset-item:hover,.preset-item.selected{border-color:var(--red);background:var(--red-soft)}
.agent-card:hover,.preset-item:hover{transform:translateY(-1px)}
.agent-card.disabled{opacity:.54}.agent-card.missing{border-style:dashed}.agent-card.success{border-color:rgba(43,166,64,.62)}.agent-card.failed,.agent-card.skipped{border-color:rgba(255,93,93,.62)}
.agent-name,.preset-title{font-size:.82rem;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agent-meta,.preset-meta{font-size:.69rem;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.preset-meta{overflow-wrap:anywhere;white-space:normal}
.main-model-label{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:1.14rem;font-weight:850;color:#f5f5f5;white-space:nowrap}
.add-agent{width:34px;height:34px;padding:0;text-align:center;border-radius:50%}.add-agent:disabled{opacity:.35;cursor:not-allowed}
.editor-empty,.empty{color:var(--muted);font-size:.84rem;padding:13px;border:1px dashed var(--line-strong);border-radius:8px;background:#121212}
.checkline{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:#d0d0d0;font-size:.78rem}.checkline input{width:auto;accent-color:var(--red)}
.memory-settings,.detail-block,.prompt-preview-block{border:1px solid var(--line);background:#121212;border-radius:7px;padding:11px;margin-top:10px}
.detail-block.sealed-detail{background:#101010}
.mini-actions,.detail-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
.mini-actions button{border-radius:8px}
.danger{border-color:rgba(255,93,93,.55);background:rgba(255,93,93,.12);color:#ffb0b0}.danger:hover{background:rgba(255,93,93,.2)}
.preset-shell{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.3fr);gap:12px;align-items:start}
.preset-item{padding:10px 11px;cursor:pointer;transition:border-color .14s ease,background .14s ease,transform .14s ease}
.preset-test-results{margin-top:10px}.test-result{padding:11px}
.test-result h3{font-size:.82rem;margin-bottom:8px;color:var(--text)}
.provider-key-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:end}
.provider-key-status{display:flex;align-items:center;min-height:38px}
.run-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
.detail-meta{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}
.detail-block h3,.prompt-preview-block h3{font-size:.78rem;color:#ddd;margin-bottom:7px}
.sealed-detail-note{font-size:.78rem;color:var(--muted);margin-top:6px}
.detail-block pre,.prompt-preview-block pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;color:#f5f5f5}
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:40;display:flex;align-items:center;justify-content:center;padding:18px}
.prompt-modal,.memory-modal,.run-log-modal{width:min(920px,100%);max-height:88vh;overflow:auto;background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;box-shadow:0 24px 80px rgba(0,0,0,.54)}
.run-log-modal{width:min(1080px,100%);overflow:hidden;display:flex;flex-direction:column}
.confirm-modal{width:min(440px,100%);background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;box-shadow:0 24px 80px rgba(0,0,0,.54);padding:16px}
.confirm-modal h2{font-size:1rem;margin-bottom:8px}.confirm-modal p{font-size:.86rem;color:#d6d6d6;overflow-wrap:anywhere}.confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}
.prompt-modal{padding:16px}.prompt-modal-head,.memory-modal-head,.run-log-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.prompt-modal-head{margin-bottom:12px}.memory-modal-head,.run-log-modal-head{border-bottom:1px solid var(--line);padding:14px 16px}.memory-modal-head h2,.run-log-modal-head h2{font-size:1rem;margin:0 0 4px}.memory-modal-body{padding:14px 16px 18px}
.run-log-modal-body{padding:14px 16px 18px;overflow:auto;min-height:0}.run-log-modal-body pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;color:#f5f5f5}
.prompt-preview-meta,.memory-snapshot-meta,.run-log-modal-meta{font-size:.76rem;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}
.memory-snapshot{padding:11px}.memory-snapshot.current{border-color:var(--red);background:var(--red-soft)}
.memory-snapshot-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}.memory-snapshot-title{font-size:.82rem;font-weight:800}
.actions{position:fixed;left:0;right:0;bottom:0;background:rgba(15,15,15,.97);border-top:1px solid var(--line);padding:10px 16px;z-index:12}
.actions-inner{max-width:1240px;margin:0 auto;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
button{padding:9px 14px;border-radius:999px;border:1px solid var(--line-strong);background:var(--surface-2);color:var(--text);cursor:pointer;font-size:.86rem;font-weight:750}
button:hover{background:var(--surface-3)}
button.primary{background:var(--red);border-color:var(--red);color:#fff}button.primary:hover{background:var(--red-hover)}
button.ghost{background:var(--surface-2);color:#f1f1f1}
@media (max-width: 860px){.wrap{padding:20px 14px 104px}.top{position:static;display:block;margin:-20px -14px 16px;padding:14px}.header-actions{justify-content:flex-start;margin-top:12px}.run-log-control-row{justify-content:flex-start}.status-strip,.grid,.row2,.pipeline-shell,.inspector-shell,.preset-shell,.pipeline-preset-controls{grid-template-columns:1fr}.pipeline-preset-actions{justify-content:flex-start}.pipeline-row,.inspector-shell .pipeline-row{grid-template-columns:72px minmax(0,1fr) 34px}.inspector-shell .pipeline-row{grid-template-columns:72px minmax(0,1fr)}.provider-key-row{grid-template-columns:1fr}.agent-card{max-width:100%}.run-log-modal{max-height:92vh}}
`;
    }

    function buildRunInspectorUI(pipeline, runLog) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${youtubeThemeStyles()}</style></head><body>
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
        ${runLog?.firstMessageSource ? `<span class="badge ${runLog.firstMessageIncluded ? 'ok' : 'neutral'}">첫 메시지: ${runLog.firstMessageIncluded ? '포함' : '미포함'} · ${escHtml(runLog.firstMessageSource)}</span>` : ''}
        ${runLog?.firstMessageError ? `<span class="badge neutral">첫 메시지 참고: ${escHtml(runLog.firstMessageError)}</span>` : ''}
        ${runLog?.placeholderUserSource ? `<span class="badge ${runLog.placeholderReplacementApplied ? 'ok' : 'neutral'}">기본 CBS 치환: ${runLog.placeholderReplacementApplied ? '적용' : '변경 없음'} · ${escHtml(runLog.placeholderUserSource)}</span>` : ''}
        ${runLog?.chatContextError ? `<span class="badge err">컨텍스트 오류: ${escHtml(runLog.chatContextError)}</span>` : ''}
        ${runLog?.preReused ? `<span class="badge ok">Pre-Agent 재사용됨</span>` : ''}
        ${runLog?.runLogEnabled === false ? `<span class="badge err">Run Log 꺼짐 · 표시 결과가 오래됐을 수 있음</span>` : '<span class="badge ok">Run Log 켜짐</span>'}
      </div>
    </div>
    <div class="header-actions">
      <div class="top-tabs" role="tablist" aria-label="Agents view">
        <button id="settings-tab-btn" class="ghost" role="tab" aria-selected="false">설정</button>
        <button id="run-inspector-tab-btn" class="primary" role="tab" aria-selected="true">Run Inspector</button>
      </div>
    </div>
  </div>
  <div class="run-log-control-row">
    <button id="run-log-toggle-btn" class="${runLog?.runLogEnabled === false ? 'ghost' : 'primary'}">${runLog?.runLogEnabled === false ? '최근 실행 결과(Run Log): 꺼짐' : '최근 실행 결과(Run Log): 켜짐'}</button>
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
      document.getElementById('run-log-toggle-btn')?.addEventListener('click', async () => {
        const nextEnabled = runLog?.runLogEnabled === false;
        await Risuai.setArgument('agents_run_log_enabled', String(nextEnabled));
        await saveConfigVault({ ...conf, runLogEnabled: nextEnabled, pipeline }, conf?.debugLog);
        await openRunInspector();
      });

      function renderInspectorRows() {
        const root = document.getElementById('inspector-rows');
        if (!root) return;
        root.innerHTML = pipeline.rows.map((row) => {
          if (row.row === MAIN_ROW_INDEX) {
            return `<div class="pipeline-row main">
              <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">Fixed</div></div>
              <div class="main-model-label">Main Model</div>
            </div>`;
          }

          const mode = row.row < MAIN_ROW_INDEX ? 'Pre' : 'Post';
          const cards = (row.agents || []).map(agent => inspectorAgentCardHtml(agent)).join('');
          const postFilled = row.row > MAIN_ROW_INDEX && Boolean(cards);
          const emptyRow = !cards;
          return `<div class="pipeline-row${postFilled ? ' post-filled' : ''}${emptyRow ? ' empty-row' : ''}">
            <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">${mode}</div></div>
            <div class="agent-lane${row.row > MAIN_ROW_INDEX ? ' post-agent-lane' : ''}">${cards || '<span class="metric-sub pipeline-empty-label">비어 있음</span>'}</div>
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
        const missing = preset ? '' : ' missing';
        const memory = agent.mode === 'pre' && agent.memoryEnabled ? ' · 기억' : '';
        const status = result ? resultStatusLabel(result.status) : '결과 없음';
        const reused = result?.reused ? ' · 재사용됨' : '';
        const postMode = agent.mode === 'post' ? ` · ${postModeLabel(result?.postMode || agent.postMode)}` : '';
        return `<div class="agent-card${selected}${disabled}${missing} ${escHtml(statusClass)}" data-agent-id="${escHtml(agent.id)}">
          <div class="agent-name">${escHtml(agent.name)}</div>
          <div class="agent-meta">${escHtml(preset ? (preset.name || preset.model || 'model preset') : '모델 미설정')} · ${escHtml(status)}${escHtml(memory)}${escHtml(postMode)}${escHtml(reused)}</div>
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
        root.querySelectorAll('[data-run-log-field]').forEach(button => {
          button.addEventListener('click', async (event) => {
            const field = event.currentTarget.getAttribute('data-run-log-field');
            const title = event.currentTarget.getAttribute('data-run-log-title') || '전문';
            const bodyKey = event.currentTarget.getAttribute('data-run-log-body-key') || '';
            const fallback = event.currentTarget.getAttribute('data-run-log-fallback') || '';
            const fallbackField = event.currentTarget.getAttribute('data-run-log-fallback-field') || '';
            const currentAgent = findAgentById(pipeline, selectedAgentId);
            const currentResult = findRunResultForAgent(runLog, currentAgent);
            if (!field || !currentAgent || !currentResult) return;

            const buttonEl = event.currentTarget;
            const previousText = buttonEl.textContent;
            buttonEl.disabled = true;
            buttonEl.textContent = '불러오는 중...';
            try {
              const storedText = bodyKey ? await loadRunLogBodyValue(bodyKey, conf?.debugLog) : '';
              const text = storedText || runLogModalFieldValue(currentResult, field, fallback, fallbackField);
              openRunLogTextModal({
                title,
                agent: currentAgent,
                result: currentResult,
                field,
                text: text || fallback || '(본문 없음)',
                bodyKey,
                hasInline: runLogHasInlineText(currentResult, field, fallbackField),
                chars: currentResult?.[`${field}Chars`],
              });
            } finally {
              buttonEl.disabled = false;
              buttonEl.textContent = previousText;
            }
          });
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
      if (runLog.runLogEnabled === false) return `${date} · ${status} · Run Log 꺼짐(저장된 이전 결과)`;
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
        ${agent.mode === 'post' ? `<span class="badge neutral">${escHtml(postModeLabel(result?.postMode || agent.postMode))}</span>` : ''}
        ${resultBadge}
        ${result?.reused ? '<span class="badge ok">재사용됨</span>' : ''}
        ${result?.memoryStatus && result.memoryStatus !== 'disabled' ? `<span class="badge ${statusBadgeClass(result.memoryStatus)}">기억: ${escHtml(memoryStatusLabel(result.memoryStatus))}</span>` : ''}
        ${Array.isArray(result?.cbsWarnings) && result.cbsWarnings.length ? `<span class="badge neutral">CBS 경고 ${escHtml(result.cbsWarnings.length)}</span>` : ''}
      </div>`;
      const memoryButton = memoryInspectorButtonHtml(agent);

      if (!result) {
        return `<h2>${escHtml(agent.name)}</h2>${meta}${memoryButton}<div class="empty">이 에이전트의 최근 실행 결과가 없습니다.</div>`;
      }

      if (agent.mode === 'post') {
        return `<h2>${escHtml(agent.name)}</h2>${meta}
          ${runLogDetailBlockHtml('에이전트 프롬프트', result, 'prompt', '(프롬프트 없음)')}
          ${runLogDetailBlockHtml('입력 응답', result, 'inputResponse', '(입력 응답 없음)')}
          ${runLogDetailBlockHtml('에이전트 출력', result, 'rawOutput', '(에이전트 출력 없음)')}
          ${runLogDetailBlockHtml('적용 후 응답', result, 'outputResponse', '(적용 후 응답 없음)')}
          ${Array.isArray(result.cbsWarnings) && result.cbsWarnings.length ? detailBlockHtml('CBS 경고', result.cbsWarnings.join('\n')) : ''}
          ${result.error ? detailBlockHtml('오류', result.error) : ''}`;
      }

      return `<h2>${escHtml(agent.name)}</h2>${meta}
        ${memoryButton}
        ${runLogDetailBlockHtml('에이전트 프롬프트', result, 'prompt', '(프롬프트 없음)')}
        ${runLogDetailBlockHtml('생성된 Note', result, 'content', '(노트 없음)')}
        ${runLogDetailBlockHtml('Raw Output', result, 'rawOutput', '(원본 출력 없음)', { fallbackField: 'content' })}
        ${Array.isArray(result.cbsWarnings) && result.cbsWarnings.length ? detailBlockHtml('CBS 경고', result.cbsWarnings.join('\n')) : ''}
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
      document.querySelectorAll('[data-memory-snapshot-key]').forEach(button => {
        button.addEventListener('click', async (event) => {
          const key = event.currentTarget.getAttribute('data-memory-snapshot-key');
          const targetId = event.currentTarget.getAttribute('data-memory-snapshot-target');
          const target = targetId ? document.getElementById(targetId) : null;
          if (!key || !target) return;
          target.innerHTML = '<div class="metric-sub">기억 내용을 불러오는 중...</div>';
          const value = await loadMemorySnapshotValue({ snapshotKey: key }, conf?.debugLog);
          target.innerHTML = detailBlockHtml('기억 내용', value || EMPTY_AGENT_MEMORY);
        });
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
          ? `<div class="memory-stack">${list.map((item, idx) => memorySnapshotHtml(item.snapshot, item.latest, idx)).join('')}</div>`
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

    function memorySnapshotHtml(snapshot, isLatest, idx = 0) {
      const label = `대화 ${snapshot.messageCount ?? 0}개 시점`;
      const updatedAt = formatInspectorTime(snapshot.updatedAt);
      const usedAt = formatInspectorTime(snapshot.usedAt);
      const bodyId = `memory-snapshot-body-${idx}`;
      return `<div class="memory-snapshot${isLatest ? ' current' : ''}">
        <div class="memory-snapshot-head">
          <div>
            <div class="memory-snapshot-title">${escHtml(label)}</div>
            <div class="memory-snapshot-meta">실제 대화 메시지 ${escHtml(snapshot.messageCount ?? 0)}개</div>
          </div>
          <div>
            <div class="memory-snapshot-meta">사용 ${escHtml(usedAt)} · 갱신 ${escHtml(updatedAt)}</div>
            <button class="ghost" data-memory-snapshot-key="${escHtml(snapshot.snapshotKey || '')}" data-memory-snapshot-target="${escHtml(bodyId)}">보기</button>
          </div>
        </div>
        ${snapshot.preview ? `<div class="metric-sub">스냅샷 기준 최근 대화: ${escHtml(snapshot.preview)}</div>` : ''}
        <div id="${escHtml(bodyId)}"></div>
      </div>`;
    }

    function formatInspectorTime(time) {
      const numeric = Number(time);
      return Number.isFinite(numeric) && numeric > 0 ? new Date(numeric).toLocaleString() : '시간 정보 없음';
    }

    function detailBlockHtml(title, text) {
      return `<div class="detail-block"><h3>${escHtml(title)}</h3><pre>${escHtml(text)}</pre></div>`;
    }

    function openRunLogTextModal(options) {
      closeRunLogTextModal();
      document.body.insertAdjacentHTML('beforeend', runLogTextModalHtml(options));
      document.getElementById('run-log-text-close')?.addEventListener('click', closeRunLogTextModal);
      document.getElementById('run-log-text-modal')?.addEventListener('click', (event) => {
        if (event.target?.id === 'run-log-text-modal') closeRunLogTextModal();
      });
      document.addEventListener('keydown', handleRunLogTextModalKeydown);
      document.getElementById('run-log-text-close')?.focus();
    }

    function closeRunLogTextModal() {
      document.getElementById('run-log-text-modal')?.remove();
      document.removeEventListener('keydown', handleRunLogTextModalKeydown);
    }

    function handleRunLogTextModalKeydown(event) {
      if (event.key === 'Escape') closeRunLogTextModal();
    }

    function runLogTextModalHtml(options) {
      const title = String(options?.title || '전문');
      const agent = options?.agent || {};
      const result = options?.result || {};
      const text = String(options?.text || '');
      const modeLabel = agent.mode === 'post' ? 'Post-Agent' : 'Pre-Agent';
      const postMode = agent.mode === 'post' ? ` · ${postModeLabel(result?.postMode || agent.postMode)}` : '';
      const charCount = runLogTextChars(result, options?.field || '', text);
      const storageState = options?.bodyKey ? '본문 저장됨' : (options?.hasInline ? '인라인 저장됨' : '본문 없음');
      const meta = `Row ${agent.row !== undefined ? agent.row + 1 : '?'} · ${modeLabel}${postMode} · 전문 ${charCount}자 · ${storageState}`;
      return `<div id="run-log-text-modal" class="modal-backdrop">
        <div class="run-log-modal" role="dialog" aria-modal="true" aria-labelledby="run-log-text-title">
          <div class="run-log-modal-head">
            <div>
              <h2 id="run-log-text-title">${escHtml(title)}</h2>
              <div class="run-log-modal-meta">${escHtml(agent.name || '(이름 없음)')} · ${escHtml(meta)}</div>
            </div>
            <button id="run-log-text-close" class="ghost">닫기</button>
          </div>
          <div class="run-log-modal-body"><pre>${escHtml(text || '(본문 없음)')}</pre></div>
        </div>
      </div>`;
    }

    function runLogFieldValue(source, field, fallback = '') {
      if (source?.[field] !== undefined && source?.[field] !== null) return String(source[field]);
      const preview = source?.[`${field}Preview`];
      if (preview !== undefined && preview !== null) return String(preview);
      return String(fallback || '');
    }

    function runLogModalFieldValue(source, field, fallback = '', fallbackField = '') {
      if (source?.[field] !== undefined && source?.[field] !== null) return String(source[field]);
      const preview = source?.[`${field}Preview`];
      if (preview !== undefined && preview !== null) return String(preview);
      if (fallbackField) return runLogFieldValue(source, fallbackField, fallback);
      return String(fallback || '');
    }

    function runLogHasInlineText(source, field, fallbackField = '') {
      return source?.[field] !== undefined && source?.[field] !== null
        || source?.[`${field}Preview`] !== undefined && source?.[`${field}Preview`] !== null
        || Boolean(fallbackField && (
          source?.[fallbackField] !== undefined && source?.[fallbackField] !== null
          || source?.[`${fallbackField}Preview`] !== undefined && source?.[`${fallbackField}Preview`] !== null
        ));
    }

    function runLogTextChars(source, field, fallbackText = '') {
      const chars = Number(source?.[`${field}Chars`]);
      return Number.isFinite(chars) && chars >= 0 ? chars : String(fallbackText || '').length;
    }

    function runLogDetailMetaHtml(source, field, text, bodyKey, fallbackField = '') {
      const chars = runLogTextChars(source, field, text);
      const state = bodyKey ? '본문 저장됨' : (runLogHasInlineText(source, field, fallbackField) ? '인라인 저장됨' : '본문 없음');
      return `<div class="metric-sub">전문 ${escHtml(chars)}자 · ${escHtml(state)}</div>`;
    }

    function runLogFullTextButtonHtml(title, field, bodyKey, fallback = '', fallbackField = '') {
      return `<div class="detail-actions"><button class="ghost" data-run-log-field="${escHtml(field)}" data-run-log-title="${escHtml(title)}" data-run-log-body-key="${escHtml(bodyKey || '')}" data-run-log-fallback="${escHtml(fallback)}" data-run-log-fallback-field="${escHtml(fallbackField)}">전문 보기</button></div>`;
    }

    function runLogDetailBlockHtml(title, source, field, fallback = '', options = {}) {
      const bodyKey = source?.[`${field}BodyKey`];
      const fallbackField = options.fallbackField || '';
      const sealed = options.sealed === true || field === 'prompt' || field === 'rawOutput';
      const inlineText = runLogModalFieldValue(source, field, fallback, fallbackField);
      const meta = runLogDetailMetaHtml(source, field, inlineText, bodyKey, fallbackField);
      const button = runLogFullTextButtonHtml(title, field, bodyKey, fallback, fallbackField);
      if (sealed) {
        return `<div class="detail-block sealed-detail">
          <h3>${escHtml(title)}</h3>
          ${meta}
          <div class="sealed-detail-note">미리보기 숨김</div>
          ${button}
        </div>`;
      }

      if (!bodyKey) {
        return detailBlockHtml(title, inlineText);
      }

      const preview = runLogFieldValue(source, field, fallback);
      return `<div class="detail-block">
        <h3>${escHtml(title)}</h3>
        ${meta}
        <pre>${escHtml(preview || '(미리보기 없음)')}</pre>
        ${button}
      </div>`;
    }

    function buildLiteUI(conf, pipeline, pipelineStore) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${youtubeThemeStyles()}</style></head><body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>Agents!</h1>
      <p class="subtitle">Row 1-4는 메인 모델 전 노트 생성, Row 5는 Main Model, Row 6-9는 응답 후처리입니다.</p>
    </div>
    <div class="header-actions">
      <div class="top-tabs" role="tablist" aria-label="Agents view">
        <button id="settings-tab-btn" class="primary" role="tab" aria-selected="true">설정</button>
        <button id="run-inspector-tab-btn" class="ghost" role="tab" aria-selected="false">Run Inspector</button>
      </div>
    </div>
  </div>

  <div id="msg" class="msg"></div>

  <div class="card">
    <h2>Pipeline Builder</h2>
    <div id="pipeline-preset-controls" class="pipeline-preset-controls"></div>
    <div class="pipeline-shell">
      <div id="pipeline-rows" class="pipeline-rows"></div>
      <div id="agent-editor" class="card" style="margin-bottom:0"></div>
    </div>
  </div>

  <details class="card collapsible-card">
    <summary><h2>Model Presets</h2><span class="collapse-state"></span></summary>
    <div class="collapsible-body preset-shell">
      <div>
        <div id="preset-list" class="preset-list"></div>
        <div class="mini-actions">
          <button id="preset-add-btn">프리셋 추가</button>
        </div>
      </div>
      <div id="preset-editor"></div>
    </div>
  </details>

  <details class="card collapsible-card">
    <summary><h2>Provider API Keys</h2><span class="collapse-state"></span></summary>
    <div id="provider-key-editor" class="collapsible-body"></div>
  </details>

  <details class="card collapsible-card">
    <summary><h2>공통 설정</h2><span class="collapse-state"></span></summary>
    <div class="collapsible-body">
      <div class="field">
        <label for="agents_debug_log">Debug Log</label>
        <select id="agents_debug_log">
          <option value="true" ${conf.debugLog ? 'selected' : ''}>켜짐 - 프롬프트 흐름을 콘솔에 출력</option>
          <option value="false" ${!conf.debugLog ? 'selected' : ''}>꺼짐</option>
        </select>
      </div>
      <div class="field">
        <label for="agents_bypass_aux_requests">보조 요청 우회</label>
        <select id="agents_bypass_aux_requests">
          <option value="true" ${conf.bypassAuxRequests ? 'selected' : ''}>켜짐 - memory/translate/otherAx 등 보조 요청은 통과</option>
          <option value="false" ${!conf.bypassAuxRequests ? 'selected' : ''}>꺼짐 - 모든 요청에 Agents! 실행</option>
        </select>
      </div>
      <div class="field">
        <label for="agents_extra_body_json">전역 추가 JSON body</label>
        <textarea id="agents_extra_body_json" spellcheck="false" placeholder='{}'>${escHtml(conf.extraBodyJson)}</textarea>
      </div>
      <div class="example-url">각 에이전트 API 요청에 병합합니다. messages 키는 무시됩니다.</div>
      <div class="field">
        <label for="agents_proxy_url">CORS Proxy URL</label>
        <input id="agents_proxy_url" type="text" value="${escHtml(conf.proxyUrl || '')}" placeholder="https://proxy.example.com">
      </div>
      <div class="row2">
        <div class="field">
          <label for="agents_proxy_key">Proxy Access Token</label>
          <input id="agents_proxy_key" type="password" value="" placeholder="${conf.proxyKey ? '설정됨 - 비워두면 유지' : '선택 사항'}" autocomplete="off">
        </div>
        <div class="field">
          <label for="agents_proxy_direct">Proxy Mode</label>
          <select id="agents_proxy_direct">
            <option value="false" ${!conf.proxyDirect ? 'selected' : ''}>Rewrite - proxy URL 뒤에 API path 붙이기</option>
            <option value="true" ${conf.proxyDirect ? 'selected' : ''}>Direct - X-Target-URL 헤더 사용</option>
          </select>
        </div>
      </div>
      <div class="example-url">RisuAI 웹에서 Ollama Cloud가 CORS로 막힐 때 사용합니다. 비워두면 직접 요청합니다.</div>
    </div>
  </details>

  <div id="test-results" class="preset-test-results"></div>
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

    function setupLiteHandlers(initialConf, initialPipeline, initialPipelineStore) {
      let modelPresetsState = normalizeModelPresets(JSON.parse(JSON.stringify(initialConf.modelPresets || [])), initialConf);
      let providerKeysState = { ...(initialConf.providerKeys || {}) };
      let selectedPresetId = modelPresetsState[0]?.id || DEFAULT_MODEL_PRESET_ID;
      let selectedProviderKeyProvider = normalizeProviderValue(modelPresetsState[0]?.provider || initialConf.provider || DEFAULT_AGENT_PROVIDER);
      let pipelinePresetStoreState = normalizePipelinePresetStore(initialPipelineStore, initialPipeline, modelPresetsState);
      let activePipelinePresetId = pipelinePresetStoreState.activePresetId;
      let pipelineState = normalizePipelineConfig(getActivePipelinePreset(pipelinePresetStoreState)?.pipeline || initialPipeline, modelPresetsState);
      let selectedAgentId = findFirstAgentId(pipelineState);

      renderPipelinePresetControls();
      renderPipeline();
      renderAgentEditor();
      renderPresetList();
      renderPresetEditor();
      renderProviderKeyEditor();

      document.getElementById('run-inspector-tab-btn')?.addEventListener('click', openRunInspector);
      document.getElementById('preset-add-btn')?.addEventListener('click', addModelPreset);
      document.getElementById('save-btn')?.addEventListener('click', async () => {
        try {
          syncActivePipelinePreset();
          const next = collectLiteConfig(initialConf, pipelineState, modelPresetsState, providerKeysState, pipelinePresetStoreState);
          await saveLiteConfig(next);
          pipelinePresetStoreState = next.pipelinePresetStore;
          activePipelinePresetId = pipelinePresetStoreState.activePresetId;
          providerKeysState = { ...(next.providerKeys || {}) };
          renderPipelinePresetControls();
          renderProviderKeyEditor();
          showMsg('저장 완료', true);
        } catch (err) {
          showMsg(`저장 오류: ${err.message}`, false);
        }
      });
      document.getElementById('close-btn')?.addEventListener('click', async () => {
          await Risuai.hideContainer();
      });

      function syncActivePipelinePreset() {
        const active = pipelinePresetStoreState.presets.find(preset => preset.id === activePipelinePresetId) || pipelinePresetStoreState.presets[0];
        if (!active) return;
        active.pipeline = normalizePipelineConfig(pipelineState, modelPresetsState);
        active.updatedAt = new Date().toISOString();
        pipelinePresetStoreState.activePresetId = active.id;
        activePipelinePresetId = active.id;
      }

      function renderPipelinePresetControls() {
        const root = document.getElementById('pipeline-preset-controls');
        if (!root) return;
        const presets = pipelinePresetStoreState.presets || [];
        const hasAgents = pipelineHasAgents(pipelineState);
        const hasEnabledAgents = pipelineHasEnabledAgents(pipelineState);
        root.innerHTML = `
          <div class="field pipeline-preset-field">
            <label for="pipeline_preset_select">Pipeline Preset</label>
            <select id="pipeline_preset_select">
              ${presets.map(preset =>
                `<option value="${escHtml(preset.id)}" ${preset.id === activePipelinePresetId ? 'selected' : ''}>${escHtml(preset.name)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="pipeline-preset-actions">
            <button id="pipeline-new-btn">새 파이프라인</button>
            <button id="pipeline-duplicate-btn">복제</button>
            <button id="pipeline-rename-btn">이름 변경</button>
            <button id="pipeline-delete-btn" class="danger">삭제</button>
            <button id="pipeline-toggle-all-btn" class="${hasEnabledAgents ? 'danger' : ''}" ${hasAgents ? '' : 'disabled'}>${hasEnabledAgents ? '전체 비활성' : '전체 활성'}</button>
            <button id="pipeline-export-btn">Export</button>
            <button id="pipeline-import-btn">Import</button>
            <input id="pipeline-import-file" class="file-input-hidden" type="file" accept="application/json,.json">
          </div>`;

        document.getElementById('pipeline_preset_select')?.addEventListener('change', (event) => {
          syncActivePipelinePreset();
          activePipelinePresetId = event.target.value;
          pipelinePresetStoreState.activePresetId = activePipelinePresetId;
          pipelineState = normalizePipelineConfig(getActivePipelinePreset(pipelinePresetStoreState)?.pipeline || createEmptyPipeline(), modelPresetsState);
          selectedAgentId = findFirstAgentId(pipelineState);
          renderPipelinePresetControls();
          renderPipeline();
          renderAgentEditor();
        });
        document.getElementById('pipeline-new-btn')?.addEventListener('click', addPipelinePreset);
        document.getElementById('pipeline-duplicate-btn')?.addEventListener('click', duplicatePipelinePreset);
        document.getElementById('pipeline-rename-btn')?.addEventListener('click', renamePipelinePreset);
        document.getElementById('pipeline-delete-btn')?.addEventListener('click', deletePipelinePreset);
        document.getElementById('pipeline-toggle-all-btn')?.addEventListener('click', toggleAllAgentsInCurrentPipeline);
        document.getElementById('pipeline-export-btn')?.addEventListener('click', exportPipelinePreset);
        document.getElementById('pipeline-import-btn')?.addEventListener('click', () => document.getElementById('pipeline-import-file')?.click());
        document.getElementById('pipeline-import-file')?.addEventListener('change', importPipelinePresetFile);
      }

      function pipelineHasAgents(pipeline) {
        return (pipeline?.rows || []).some((row) => {
          if (row.row === MAIN_ROW_INDEX) return false;
          return (row.agents || []).length > 0;
        });
      }

      function pipelineHasEnabledAgents(pipeline) {
        return (pipeline?.rows || []).some((row) => {
          if (row.row === MAIN_ROW_INDEX) return false;
          return (row.agents || []).some(agent => agent.enabled !== false);
        });
      }

      function addPipelinePreset() {
        syncActivePipelinePreset();
        const preset = createPipelinePreset(`새 파이프라인 ${pipelinePresetStoreState.presets.length + 1}`, createEmptyPipeline());
        pipelinePresetStoreState.presets.push(preset);
        activePipelinePresetId = preset.id;
        pipelinePresetStoreState.activePresetId = preset.id;
        pipelineState = normalizePipelineConfig(preset.pipeline, modelPresetsState);
        selectedAgentId = null;
        renderPipelinePresetControls();
        renderPipeline();
        renderAgentEditor();
      }

      function duplicatePipelinePreset() {
        syncActivePipelinePreset();
        const active = getActivePipelinePreset(pipelinePresetStoreState);
        if (!active) return;
        const preset = createPipelinePreset(`${active.name} 복사본`, active.pipeline);
        pipelinePresetStoreState.presets.push(preset);
        activePipelinePresetId = preset.id;
        pipelinePresetStoreState.activePresetId = preset.id;
        pipelineState = normalizePipelineConfig(preset.pipeline, modelPresetsState);
        selectedAgentId = findFirstAgentId(pipelineState);
        renderPipelinePresetControls();
        renderPipeline();
        renderAgentEditor();
      }

      function renamePipelinePreset() {
        const active = getActivePipelinePreset(pipelinePresetStoreState);
        if (!active) return;
        const nextName = window.prompt('Pipeline Preset 이름', active.name);
        if (nextName === null) return;
        const trimmed = nextName.trim();
        if (!trimmed) {
          showMsg('파이프라인 이름을 입력하세요.', false);
          return;
        }
        active.name = trimmed;
        active.updatedAt = new Date().toISOString();
        renderPipelinePresetControls();
      }

      async function deletePipelinePreset() {
        if ((pipelinePresetStoreState.presets || []).length <= 1) {
          showMsg('최소 1개의 파이프라인 프리셋은 필요합니다.', false);
          return;
        }
        const active = getActivePipelinePreset(pipelinePresetStoreState);
        if (!active) return;
        const confirmed = await showConfirmDialog({
          title: '파이프라인 삭제',
          message: `"${active.name}" 파이프라인을 정말 삭제할까요?`,
          confirmText: '삭제',
        });
        if (!confirmed) return;
        pipelinePresetStoreState.presets = pipelinePresetStoreState.presets.filter(preset => preset.id !== active.id);
        const next = pipelinePresetStoreState.presets[0];
        activePipelinePresetId = next.id;
        pipelinePresetStoreState.activePresetId = next.id;
        pipelineState = normalizePipelineConfig(next.pipeline, modelPresetsState);
        selectedAgentId = findFirstAgentId(pipelineState);
        renderPipelinePresetControls();
        renderPipeline();
        renderAgentEditor();
      }

      function toggleAllAgentsInCurrentPipeline() {
        const enableAll = !pipelineHasEnabledAgents(pipelineState);
        pipelineState.rows.forEach((row) => {
          if (row.row === MAIN_ROW_INDEX) return;
          (row.agents || []).forEach((agent) => {
            agent.enabled = enableAll;
          });
        });
        renderPipelinePresetControls();
        renderPipeline();
        renderAgentEditor();
        showMsg(enableAll ? '전체 에이전트를 활성화했습니다. 저장 버튼을 눌러 적용하세요.' : '전체 에이전트를 비활성화했습니다. 저장 버튼을 눌러 적용하세요.', true);
      }

      function exportPipelinePreset() {
        syncActivePipelinePreset();
        const active = getActivePipelinePreset(pipelinePresetStoreState);
        if (!active) return;
        downloadJsonFile(`agents-pipeline-${safeFilePart(active.name)}.json`, {
          kind: PIPELINE_EXPORT_KIND,
          version: 1,
          name: active.name,
          exportedAt: new Date().toISOString(),
          pipeline: pipelineForExport(active.pipeline),
        });
        showMsg('Pipeline preset JSON을 내보냈습니다.', true);
      }

      async function importPipelinePresetFile(event) {
        const input = event.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
          const payload = JSON.parse(await file.text());
          if (payload?.kind !== PIPELINE_EXPORT_KIND || !payload.pipeline) {
            throw new Error('Agents! pipeline preset JSON이 아닙니다.');
          }
          syncActivePipelinePreset();
          const imported = pipelineForImport(payload.pipeline);
          const preset = createPipelinePreset(String(payload.name || file.name.replace(/\.json$/i, '') || 'Imported Pipeline'), imported);
          pipelinePresetStoreState.presets.push(preset);
          activePipelinePresetId = preset.id;
          pipelinePresetStoreState.activePresetId = preset.id;
          pipelineState = normalizePipelineConfig(preset.pipeline, modelPresetsState);
          selectedAgentId = findFirstAgentId(pipelineState);
          renderPipelinePresetControls();
          renderPipeline();
          renderAgentEditor();
          showMsg('Pipeline preset을 가져왔습니다. 저장 버튼을 눌러 적용하세요.', true);
        } catch (err) {
          showMsg(`Pipeline import 오류: ${err.message}`, false);
        }
      }

      function exportAgentPreset(agent) {
        if (!agent) return;
        downloadJsonFile(`agents-agent-${safeFilePart(agent.name)}.json`, {
          kind: AGENT_EXPORT_KIND,
          version: 1,
          exportedAt: new Date().toISOString(),
          agent: agentForExport(agent),
        });
        showMsg('Agent preset JSON을 내보냈습니다.', true);
      }

      async function importAgentPresetFile(event, targetAgent = null) {
        const input = event.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
          const payload = JSON.parse(await file.text());
          if (payload?.kind !== AGENT_EXPORT_KIND || !payload.agent) {
            throw new Error('Agents! agent preset JSON이 아닙니다.');
          }
          const targetRow = targetAgent?.row ?? firstEditableRow();
          if (targetRow === MAIN_ROW_INDEX) throw new Error('Main Model row에는 에이전트를 추가할 수 없습니다.');
          const row = pipelineState.rows[targetRow];
          if (!row) throw new Error('가져올 row를 찾을 수 없습니다.');
          if (!targetAgent && targetRow > MAIN_ROW_INDEX && row.agents.length > 0) {
            throw new Error('Post row에는 에이전트를 1개만 둘 수 있습니다.');
          }

          let imported;
          if (targetAgent) {
            const targetIndex = row.agents.findIndex(agent => agent.id === targetAgent.id);
            if (targetIndex < 0) throw new Error('교체할 에이전트를 찾을 수 없습니다.');
            imported = agentForImport(payload.agent, targetRow, targetIndex, targetAgent.id);
            row.agents[targetIndex] = imported;
          } else {
            imported = agentForImport(payload.agent, targetRow, row.agents.length);
            row.agents.push(imported);
          }
          selectedAgentId = imported.id;
          pipelineState = normalizePipelineConfig(pipelineState, modelPresetsState);
          renderPipeline();
          renderAgentEditor();
          showMsg(targetAgent ? 'Agent preset으로 현재 에이전트를 교체했습니다. 저장 버튼을 눌러 적용하세요.' : 'Agent preset을 가져왔습니다. 저장 버튼을 눌러 적용하세요.', true);
        } catch (err) {
          showMsg(`Agent import 오류: ${err.message}`, false);
        }
      }

      function firstEditableRow() {
        const selected = findAgentById(pipelineState, selectedAgentId);
        if (selected) return selected.row;
        return 0;
      }

      function pipelineForExport(pipeline) {
        const exported = normalizePipelineConfig(pipeline, modelPresetsState);
        exported.rows.forEach((row) => {
          row.agents = (row.agents || []).map(agentForExport);
        });
        return exported;
      }

      function pipelineForImport(pipeline) {
        const imported = normalizePipelineConfig(pipeline, []);
        imported.rows.forEach((row) => {
          row.agents = (row.agents || []).map((agent, idx) => agentForImport(agent, row.row, idx));
        });
        return normalizePipelineConfig(imported, []);
      }

      function agentForExport(agent) {
        const exported = cloneJson(agent);
        exported.includeGlobalNoteReplacement = exported.includeGlobalNoteReplacement === true;
        exported.modelPresetId = UNSET_MODEL_PRESET_ID;
        return exported;
      }

      function agentForImport(agent, row, column, existingId = '') {
        return normalizeAgent({
          ...cloneJson(agent),
          id: existingId || makeAgentId(row < MAIN_ROW_INDEX ? 'pre' : 'post'),
          modelPresetId: UNSET_MODEL_PRESET_ID,
        }, row, column, []);
      }

      function downloadJsonFile(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      function safeFilePart(value) {
        return String(value || 'preset')
          .trim()
          .replace(/[\\/:*?"<>|]+/g, '-')
          .replace(/\s+/g, '-')
          .slice(0, 80) || 'preset';
      }

      function renderPipeline() {
        const root = document.getElementById('pipeline-rows');
        if (!root) return;

        root.innerHTML = pipelineState.rows.map((row) => {
          if (row.row === MAIN_ROW_INDEX) {
            return `<div class="pipeline-row main">
              <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">Fixed</div></div>
              <div class="main-model-label">Main Model</div>
            </div>`;
          }

          const mode = row.row < MAIN_ROW_INDEX ? 'Pre' : 'Post';
          const canAdd = row.row < MAIN_ROW_INDEX || row.agents.length === 0;
          const cards = row.agents.map(agent => agentCardHtml(agent)).join('');
          const postFilled = row.row > MAIN_ROW_INDEX && Boolean(cards);
          const emptyRow = !cards;

          return `<div class="pipeline-row${postFilled ? ' post-filled' : ''}${emptyRow ? ' empty-row' : ''}">
            <div><div class="row-label">Row ${row.row + 1}</div><div class="row-kind">${mode}</div></div>
            <div class="agent-lane${row.row > MAIN_ROW_INDEX ? ' post-agent-lane' : ''}">${cards || '<span class="metric-sub pipeline-empty-label">비어 있음</span>'}</div>
            ${postFilled ? '' : `<button class="add-agent" data-add-row="${row.row}" ${canAdd ? '' : 'disabled'}>+</button>`}
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
        const missing = preset ? '' : ' missing';
        const model = preset ? (preset.name || preset.model || 'model preset') : '모델 미설정';
        const context = preset?.contextWindow || '-';
        const memory = agent.mode === 'pre' && agent.memoryEnabled ? ' · 기억' : '';
        const postMode = agent.mode === 'post' ? ` · ${postModeLabel(agent.postMode)}` : '';
        return `<div class="agent-card${selected}${disabled}${missing}" data-agent-id="${escHtml(agent.id)}">
          <div class="agent-name">${escHtml(agent.name)}</div>
          <div class="agent-meta">${escHtml(model)} · ${escHtml(context)}${escHtml(memory)}${escHtml(postMode)}</div>
        </div>`;
      }

      function renderAgentEditor() {
        const root = document.getElementById('agent-editor');
        if (!root) return;
        const agent = findAgentById(pipelineState, selectedAgentId);
        if (!agent) {
          root.innerHTML = `<h2>Agent Editor</h2>
            <div class="editor-empty">에이전트 카드를 선택하거나 + 버튼으로 새 에이전트를 추가하세요.</div>
            <div class="mini-actions">
              <button id="agent-import-btn">Agent Import</button>
              <input id="agent-import-file" class="file-input-hidden" type="file" accept="application/json,.json">
            </div>`;
          document.getElementById('agent-import-btn')?.addEventListener('click', () => document.getElementById('agent-import-file')?.click());
          document.getElementById('agent-import-file')?.addEventListener('change', (event) => importAgentPresetFile(event, null));
          return;
        }

        const memoryEditor = agent.mode === 'pre'
          ? `<label class="checkline"><input id="edit_memoryEnabled" type="checkbox" ${agent.memoryEnabled ? 'checked' : ''}> 기억 활성화</label>
             ${agent.memoryEnabled ? `<div class="memory-settings">
               <div class="field"><label for="edit_memoryInstruction">기억 지시</label><textarea id="edit_memoryInstruction" placeholder="예: 현재 대화에서 계속 참고해야 할 인물, 장소, 약속, 단서를 기억하세요.">${escHtml(agent.memoryInstruction)}</textarea></div>
               <div class="field"><label for="edit_memoryFormat">기억 포맷</label><textarea id="edit_memoryFormat" placeholder="예: 핵심 항목을 짧은 목록으로 정리하세요. 예: 인물 - 내용 / 장소 - 내용">${escHtml(agent.memoryFormat)}</textarea></div>
             </div>` : ''}`
          : '';
        const postModeEditor = agent.mode === 'post'
          ? `<div class="field"><label for="edit_postMode">후처리 방식</label>${postModeSelect('edit_postMode', agent.postMode)}</div>`
          : '';

        root.innerHTML = `<h2>Agent Editor</h2>
          <div class="field"><label for="edit_name">Name</label><input id="edit_name" type="text" value="${escHtml(agent.name)}"></div>
          <label class="checkline"><input id="edit_enabled" type="checkbox" ${agent.enabled ? 'checked' : ''}> 활성화</label>
          <div class="field"><label for="edit_modelPresetId">Model Preset</label>${modelPresetSelect('edit_modelPresetId', agent.modelPresetId, modelPresetsState)}</div>
          ${postModeEditor}
          <div class="field"><label for="edit_systemPrompt">System Prompt</label><textarea id="edit_systemPrompt">${escHtml(agent.systemPrompt)}</textarea></div>
          <div class="field"><label for="edit_outputInstruction">Output Instruction</label><textarea id="edit_outputInstruction">${escHtml(agent.outputInstruction)}</textarea></div>
          <label class="checkline"><input id="edit_includeSettingBlocks" type="checkbox" ${agent.includeSettingBlocks ? 'checked' : ''}> 설정 정보 포함</label>
          <label class="checkline"><input id="edit_includeGlobalNoteReplacement" type="checkbox" ${agent.includeGlobalNoteReplacement ? 'checked' : ''}> 글로벌 노트 덮어쓰기 포함</label>
          <label class="checkline"><input id="edit_includeHistory" type="checkbox" ${agent.includeHistory ? 'checked' : ''}> 최근 대화 포함</label>
          <label class="checkline"><input id="edit_includeUserInput" type="checkbox" ${agent.includeUserInput ? 'checked' : ''}> 현재 유저 입력 포함</label>
          <label class="checkline"><input id="edit_includePreviousNotes" type="checkbox" ${agent.includePreviousNotes ? 'checked' : ''}> 이전 노트 포함</label>
          ${memoryEditor}
          <div class="mini-actions">
            <button id="agent-preview-btn">프롬프트 확인</button>
            <button id="agent-left-btn">←</button>
            <button id="agent-right-btn">→</button>
            <button id="agent-delete-btn" class="danger">삭제</button>
            <button id="agent-export-btn">Export</button>
            <button id="agent-import-btn">Import</button>
            <input id="agent-import-file" class="file-input-hidden" type="file" accept="application/json,.json">
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

        document.getElementById('edit_postMode')?.addEventListener('change', (event) => {
          const previousInstruction = agent.outputInstruction;
          agent.postMode = normalizePostMode(event.target.value);
          if (isDefaultPostOutputInstruction(previousInstruction)) {
            agent.outputInstruction = defaultOutputInstructionForPostMode(agent.postMode);
          }
          renderPipeline();
          renderAgentEditor();
        });

        ['enabled', 'includeSettingBlocks', 'includeGlobalNoteReplacement', 'includeHistory', 'includeUserInput', 'includePreviousNotes'].forEach((field) => {
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
        document.getElementById('agent-export-btn')?.addEventListener('click', () => exportAgentPreset(agent));
        document.getElementById('agent-import-btn')?.addEventListener('click', () => document.getElementById('agent-import-file')?.click());
        document.getElementById('agent-import-file')?.addEventListener('change', (event) => importAgentPresetFile(event, agent));
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
          globalNoteReplacement:
            '(현재 캐릭터의 글로벌 노트 덮어쓰기 내용이 들어갑니다)',
          history:
            '(선택한 Model Preset의 contextWindow 기준 최근 대화가 들어갑니다. 짧은 대화에서는 봇 첫 메시지도 포함됩니다)',
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
        const postModeText = agent.mode === 'post' ? ` · ${postModeLabel(agent.postMode)}` : '';
        return `<div id="prompt-preview-backdrop" class="modal-backdrop">
          <div class="prompt-modal" role="dialog" aria-modal="true" aria-label="프롬프트 확인">
            <div class="prompt-modal-head">
              <div>
                <h2>프롬프트 확인</h2>
                <div class="prompt-preview-meta">${escHtml(agent.name)} · Row ${escHtml(agent.row + 1)} · ${escHtml(modeLabel)}${escHtml(postModeText)} · ${escHtml(preset ? (preset.name || preset.model) : '모델 미설정')}</div>
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
          postMode: POST_MODE_POLISH,
          modelPresetId: UNSET_MODEL_PRESET_ID,
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

      async function deleteAgent(agent) {
        const confirmed = await showConfirmDialog({
          title: '에이전트 삭제',
          message: `"${agent.name}" 에이전트를 정말 삭제할까요?`,
          confirmText: '삭제',
        });
        if (!confirmed) return;
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
            <div class="preset-meta">${escHtml(preset.provider)} · ${escHtml(preset.model)}${escHtml(reasoningQuickSettingMeta(preset))}</div>
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
        const providerWarning = isOllamaProvider(preset.provider)
          ? '<div class="example-url">RisuAI 웹판에서 Ollama Cloud 직접 호출은 CORS로 막힐 수 있습니다. 공통 설정의 CORS Proxy URL을 사용하세요.</div>'
          : '';

        root.innerHTML = `
          <div class="field"><label for="preset_name">Preset Name</label><input id="preset_name" type="text" value="${escHtml(preset.name)}"></div>
          <div class="field"><label for="preset_provider">Provider</label>${presetProviderSelect('preset_provider', preset.provider)}</div>
          ${endpointField}
          ${providerWarning}
          <div class="field"><label for="preset_model_select">Model</label>${modelSelect('preset_model', preset.provider, preset.model)}</div>
          <div class="row2">
            <div class="field"><label for="preset_temperature">Temperature</label><input id="preset_temperature" type="number" value="${escHtml(preset.temperature)}"></div>
            <div class="field"><label for="preset_maxTokens">Max Tokens</label><input id="preset_maxTokens" type="number" value="${escHtml(preset.maxTokens)}" placeholder="비우면 provider 기본값"></div>
          </div>
          <div class="field"><label for="preset_contextWindow">Context Window</label><input id="preset_contextWindow" type="number" min="1" value="${escHtml(preset.contextWindow)}"></div>
          <div class="field"><label for="preset_reasoningQuickSetting">Reasoning Quick Setting</label>${reasoningQuickSettingSelect('preset_reasoningQuickSetting', preset.provider, preset.reasoningQuickSetting)}</div>
          <div class="field"><label for="preset_extraBodyJson">프리셋 추가 JSON body</label><textarea id="preset_extraBodyJson" spellcheck="false" placeholder='{}'>${escHtml(preset.extraBodyJson || '')}</textarea></div>
          <div class="example-url">전역 추가 JSON 이후에 병합합니다. provider-native thinking JSON을 직접 쓸 때는 Quick Setting을 Default로 두세요.</div>
          <div class="mini-actions">
            <button id="preset-test-btn">Preset test</button>
            <button id="preset-delete-btn" class="danger">프리셋 삭제</button>
          </div>
          <div id="preset-test-results" class="preset-test-results"></div>`;

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

        document.getElementById('preset_reasoningQuickSetting')?.addEventListener('change', (event) => {
          preset.reasoningQuickSetting = normalizeReasoningQuickSetting(preset.provider, event.target.value);
          renderPresetList();
        });

        document.getElementById('preset_extraBodyJson')?.addEventListener('input', (event) => {
          preset.extraBodyJson = event.target.value;
          renderPresetList();
        });

        document.getElementById('preset_provider')?.addEventListener('change', (event) => {
          const previousModel = preset.model;
          preset.provider = event.target.value;
          const defaults = providerDefaults(preset.provider);
          if (defaults) preset.baseUrl = defaults.baseUrl;
          if (defaults && shouldReplaceModel(previousModel)) preset.model = defaults.model;
          preset.reasoningQuickSetting = normalizeReasoningQuickSetting(preset.provider, preset.reasoningQuickSetting);
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
          reasoningQuickSetting: 'default',
          extraBodyJson: '',
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
        pipelineState.rows.forEach((row) => {
          row.agents.forEach((agent) => {
            if (agent.modelPresetId === preset.id) agent.modelPresetId = UNSET_MODEL_PRESET_ID;
          });
        });
        selectedPresetId = modelPresetsState[0].id;
        renderPipeline();
        renderAgentEditor();
        renderPresetList();
        renderPresetEditor();
        renderProviderKeyEditor();
      }

      async function testSelectedPreset() {
        const preset = findModelPreset(modelPresetsState, selectedPresetId);
        if (!preset) {
          showMsg('테스트할 모델 프리셋을 선택하세요.', false);
          return;
        }
        const conf = {
          provider: preset.provider,
          baseUrl: normalizeUrl(preset.baseUrl || DEFAULT_AGENT_BASE_URL),
          apiKey: providerKeysState[preset.provider] || '',
          model: preset.model || DEFAULT_AGENT_MODEL,
          proxyUrl: normalizeProxyUrl(getInputValue('agents_proxy_url')),
          proxyKey: getInputValue('agents_proxy_key') || initialConf.proxyKey || '',
          proxyDirect: parseBool(getInputValue('agents_proxy_direct'), false),
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
      return `<select id="${id}">
        <option value="${UNSET_MODEL_PRESET_ID}" ${!selectedId ? 'selected' : ''}>${MODEL_PRESET_UNSET_LABEL}</option>
        ${presets.map((preset) =>
        `<option value="${escHtml(preset.id)}" ${preset.id === selectedId ? 'selected' : ''}>${escHtml(preset.name)} - ${escHtml(preset.model)}</option>`
      ).join('')}</select>`;
    }

    function postModeSelect(id, selectedMode) {
      const selected = normalizePostMode(selectedMode);
      return `<select id="${id}">
        <option value="${POST_MODE_POLISH}" ${selected === POST_MODE_POLISH ? 'selected' : ''}>전체 다듬기</option>
        <option value="${POST_MODE_PREFIX}" ${selected === POST_MODE_PREFIX ? 'selected' : ''}>앞에 추가</option>
        <option value="${POST_MODE_SUFFIX}" ${selected === POST_MODE_SUFFIX ? 'selected' : ''}>뒤에 추가</option>
      </select>`;
    }

    function reasoningQuickSettingValuesForProvider(provider) {
      const normalized = normalizeProviderValue(provider);
      if (isOpenAIProvider(normalized)) return ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      if (isGoogleProvider(normalized)) return ['default', 'none', 'minimal', 'low', 'medium', 'high'];
      if (isVertexProvider(normalized)) return ['default', 'low', 'medium', 'high'];
      if (isDeepSeekProvider(normalized)) return ['default', 'disabled', 'high', 'max'];
      if (isAnthropicProvider(normalized)) return ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
      if (isOllamaProvider(normalized)) return ['default', 'none', 'low', 'medium', 'high'];
      return ['default'];
    }

    function normalizeReasoningQuickSetting(provider, value) {
      const raw = String(value || 'default').trim().toLowerCase();
      const selected = raw || 'default';
      const values = reasoningQuickSettingValuesForProvider(provider);
      return values.includes(selected) ? selected : 'default';
    }

    function reasoningQuickSettingSelect(id, provider, value) {
      const selected = normalizeReasoningQuickSetting(provider, value);
      const labels = {
        default: 'Default',
        none: 'None',
        minimal: 'Minimal',
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'XHigh',
        max: 'Max',
        disabled: 'Disabled',
      };
      return `<select id="${id}">
        ${reasoningQuickSettingValuesForProvider(provider).map(option =>
        `<option value="${escHtml(option)}" ${option === selected ? 'selected' : ''}>${escHtml(labels[option] || option)}</option>`
      ).join('')}
      </select>`;
    }

    function reasoningQuickSettingMeta(preset) {
      const setting = normalizeReasoningQuickSetting(preset?.provider, preset?.reasoningQuickSetting);
      return setting === 'default' ? '' : ` · reasoning ${setting}`;
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

    function collectLiteConfig(initialConf, pipeline, modelPresets, providerKeys, pipelinePresetStore) {
      const normalizedPresets = normalizeModelPresets(modelPresets, initialConf, { strictExtraBody: true });
      const firstPreset = normalizedPresets[0] || defaultModelPreset(initialConf);
      const normalizedPipelineStore = normalizePipelinePresetStore(pipelinePresetStore, pipeline, normalizedPresets);
      const active = getActivePipelinePreset(normalizedPipelineStore);
      if (active) {
        active.pipeline = normalizePipelineConfig(pipeline, normalizedPresets);
        active.updatedAt = new Date().toISOString();
      }
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
        debugLog: parseBool(getInputValue('agents_debug_log'), false),
        runLogEnabled: initialConf.runLogEnabled === true,
        bypassAuxRequests: parseBool(getInputValue('agents_bypass_aux_requests'), true),
        extraBodyJson: normalizeExtraBodyJson(getInputValue('agents_extra_body_json')),
        proxyUrl: normalizeProxyUrl(getInputValue('agents_proxy_url')),
        proxyKey: getInputValue('agents_proxy_key') || initialConf.proxyKey || '',
        proxyDirect: parseBool(getInputValue('agents_proxy_direct'), false),
        pipeline: normalizePipelineConfig(active?.pipeline || pipeline, normalizedPresets),
        pipelinePresetStore: normalizedPipelineStore,
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
      await Risuai.setArgument('agents_run_log_enabled', String(conf.runLogEnabled === true));
      await Risuai.setArgument('agents_bypass_aux_requests', String(conf.bypassAuxRequests));
      await Risuai.setArgument('agents_extra_body_json', conf.extraBodyJson || '');
      await Risuai.setArgument('agents_proxy_url', conf.proxyUrl || '');
      await Risuai.setArgument('agents_proxy_key', conf.proxyKey || '');
      await Risuai.setArgument('agents_proxy_direct', String(conf.proxyDirect));
      conf.pipelinePresetStore = await savePipelinePresetStore(conf.pipelinePresetStore, conf.pipeline, conf);
      await Risuai.setArgument('agents_model_presets_json', JSON.stringify(conf.modelPresets));
      await Risuai.setArgument('agents_provider_keys_json', JSON.stringify(conf.providerKeys));
      await saveConfigVault(conf, conf.debugLog);
    }

    async function testProviderEndpoint(conf) {
      if (isAnthropicProvider(conf.provider)) {
        const url = `${conf.baseUrl}/models/${conf.model}`;
        logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test Anthropic models start', url);
        const res = await nativeFetchWithTimeout(url, {
          method: 'GET',
          headers: {
            'x-api-key': conf.apiKey,
            'anthropic-version': '2023-06-01',
          },
        }, 'Anthropic models test', conf);
        logAgentFetch({ ...conf, debugLog: true }, `LLM auth test Anthropic models response ${res.status}`, url);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
        }
        return { status: res.status, url };
      }

      if (isVertexProvider(conf.provider)) {
        const vertexCredential = parseVertexCredential(conf.apiKey);
        const baseUrl = resolveVertexBaseUrl(conf.baseUrl, vertexCredential);
        const url = `${baseUrl}/chat/completions`;
        logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test Vertex token start', 'https://oauth2.googleapis.com/token');
        await getVertexAccessToken(conf.apiKey);
        logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test Vertex token response 200', 'https://oauth2.googleapis.com/token');
        return { status: 200, url };
      }

      const url = `${conf.baseUrl}/models`;
      logAgentFetch({ ...conf, debugLog: true }, 'LLM auth test OpenAI-compatible models start', url);
      const res = await nativeFetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${conf.apiKey}`,
        },
      }, 'OpenAI-compatible models test', conf);
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
        <div class="test-result">
          <h3>Preset test</h3>
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
      const el = document.getElementById('preset-test-results') || document.getElementById('test-results');
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

    function showConfirmDialog(options = {}) {
      const title = options.title || '확인';
      const message = options.message || '계속할까요?';
      const confirmText = options.confirmText || '확인';
      const cancelText = options.cancelText || '취소';
      const modalId = 'agents-confirm-modal';

      document.getElementById(modalId)?.remove();

      return new Promise((resolve) => {
        document.body.insertAdjacentHTML('beforeend', `
          <div id="${modalId}" class="modal-backdrop">
            <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
              <h2 id="${modalId}-title">${escHtml(title)}</h2>
              <p>${escHtml(message)}</p>
              <div class="confirm-actions">
                <button id="${modalId}-cancel" class="ghost" type="button">${escHtml(cancelText)}</button>
                <button id="${modalId}-confirm" class="danger" type="button">${escHtml(confirmText)}</button>
              </div>
            </div>
          </div>`);

        const modal = document.getElementById(modalId);
        const confirm = document.getElementById(`${modalId}-confirm`);
        const cancel = document.getElementById(`${modalId}-cancel`);

        const close = (value) => {
          document.removeEventListener('keydown', onKeydown);
          modal?.remove();
          resolve(value);
        };
        const onKeydown = (event) => {
          if (event.key === 'Escape') close(false);
        };

        modal?.addEventListener('click', (event) => {
          if (event.target?.id === modalId) close(false);
        });
        confirm?.addEventListener('click', () => close(true));
        cancel?.addEventListener('click', () => close(false));
        document.addEventListener('keydown', onKeydown);
        confirm?.focus();
      });
    }

    function getInputValue(id) {
      return document.getElementById(id)?.value?.trim() || '';
    }

    function providerOptions() {
      return [
        { value: 'openai', label: 'OpenAI' },
        { value: 'google', label: 'Google' },
        { value: 'claude', label: 'Claude' },
        { value: 'vertex-ai', label: 'Vertex AI' },
        { value: 'deepseek', label: 'DeepSeek' },
        { value: 'ollama', label: 'Ollama (웹판은 Proxy 권장)' },
        { value: 'custom', label: 'Custom' },
      ];
    }

    function providerDefaults(provider) {
      const normalized = normalizeProviderValue(provider);
      const defaults = {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          model: DEFAULT_AGENT_MODEL,
        },
        ollama: {
          baseUrl: 'https://ollama.com/v1',
          model: 'gemini-3-flash-preview:cloud',
        },
        claude: {
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        },
        'vertex-ai': {
          baseUrl: 'https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi',
          model: 'google/gemini-2.5-flash',
        },
        deepseek: {
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
        },
        google: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-flash',
        },
      };
      return defaults[normalized] || null;
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

    function parseVertexCredential(text) {
      try {
        const parsed = JSON.parse(text);
        const missing = ['type', 'project_id', 'client_email', 'private_key'].filter(key => !parsed[key]);
        if (missing.length) throw new Error(`필수 필드 누락: ${missing.join(', ')}`);
        return parsed;
      } catch (err) {
        if (err instanceof SyntaxError) throw new Error(`JSON 파싱 실패: ${err.message}`);
        throw err;
      }
    }

    function resolveVertexBaseUrl(baseUrl, credential) {
      const projectId = String(credential?.project_id || '').trim();
      let resolved = normalizeUrl(baseUrl);
      if (resolved.includes('PROJECT_ID')) {
        if (!projectId) {
          throw new Error('Vertex AI Base URL의 PROJECT_ID를 치환할 수 없습니다: service account JSON의 project_id가 없습니다.');
        }
        resolved = resolved.replace(/PROJECT_ID/g, encodeURIComponent(projectId));
      }
      if (resolved.includes('PROJECT_ID')) {
        throw new Error('Vertex AI Base URL의 PROJECT_ID를 치환할 수 없습니다.');
      }
      return resolved;
    }

    async function getVertexAccessToken(text) {
      const now = Math.floor(Date.now() / 1000);
      if (vertexTokenCache?.source === text && vertexTokenCache.expiresAt > now + 60) {
        return vertexTokenCache.token;
      }

      const info = parseVertexCredential(text);
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

      const res = await nativeFetchWithTimeout('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }, 'Vertex AI access token');
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

    function isOpenAIProvider(provider) {
      return normalizeProviderValue(provider) === 'openai';
    }

    function isGoogleProvider(provider) {
      return normalizeProviderValue(provider) === 'google';
    }

    function isAnthropicProvider(provider) {
      const normalized = normalizeProviderValue(provider);
      return normalized === 'anthropic' || normalized === 'claude';
    }

    function isVertexProvider(provider) {
      const normalized = normalizeProviderValue(provider);
      return normalized === 'vertex-ai' || normalized === 'vertex';
    }

    function isOllamaProvider(provider) {
      return normalizeProviderValue(provider) === 'ollama';
    }

    function isDeepSeekProvider(provider) {
      return normalizeProviderValue(provider) === 'deepseek';
    }

    function normalizeProviderValue(value) {
      return String(value || '').trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
    }

    function normalizeUrl(url) {
      return String(url || DEFAULT_AGENT_BASE_URL).replace(/\/$/, '');
    }

    function normalizeProxyUrl(url) {
      let value = String(url || '').trim().replace(/\/+$/, '');
      if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
      return value;
    }

    function resolveProxyRequest(url, options = {}, conf = null) {
      const proxyUrl = normalizeProxyUrl(conf?.proxyUrl);
      if (!proxyUrl) return { url, options };

      const headers = { ...(options.headers || {}) };
      const proxyKey = String(conf?.proxyKey || '').trim();
      if (proxyKey) headers['X-Proxy-Token'] = proxyKey;

      if (conf?.proxyDirect) {
        headers['X-Target-URL'] = url;
        return {
          url: proxyUrl,
          options: { ...options, headers },
        };
      }

      try {
        const target = new URL(url);
        const proxy = new URL(proxyUrl);
        const proxiedUrl = `${proxy.origin}${proxy.pathname.replace(/\/+$/, '')}${target.pathname}${target.search}`;
        return {
          url: proxiedUrl,
          options: { ...options, headers },
        };
      } catch (_) {
        return { url, options };
      }
    }

    async function nativeFetchWithTimeout(url, options = {}, label = 'request', conf = null) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timeoutId = null;
      const timeoutError = () => new Error(`${label} timed out after ${Math.round(AGENT_LLM_TIMEOUT_MS / 1000)}s`);

      try {
        if (controller) {
          timeoutId = setTimeout(() => controller.abort(), AGENT_LLM_TIMEOUT_MS);
          const request = resolveProxyRequest(url, {
            ...options,
            signal: controller.signal,
          }, conf);
          return await Risuai.nativeFetch(request.url, request.options);
        }

        const request = resolveProxyRequest(url, options, conf);
        return await Promise.race([
          Risuai.nativeFetch(request.url, request.options),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(timeoutError()), AGENT_LLM_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        if (controller?.signal?.aborted || err?.name === 'AbortError') throw timeoutError();
        throw err;
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
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
      if (conf.proxyUrl) {
        info.proxyUrl = conf.proxyUrl;
        info.proxyMode = conf.proxyDirect ? 'direct' : 'rewrite';
      }
      if (payload) {
        info.messageCount = Array.isArray(payload.messages) ? payload.messages.length : undefined;
        info.temperature = payload.temperature;
        info.max_tokens = payload.max_tokens;
        info.reasoningQuickSetting = normalizeReasoningQuickSetting(conf.provider, conf.reasoningQuickSetting);
        if (payload.reasoning_effort !== undefined) info.reasoning_effort = payload.reasoning_effort;
        if (isPlainObject(payload.reasoning) && payload.reasoning.effort !== undefined) info.reasoning_effort_nested = payload.reasoning.effort;
        if (isPlainObject(payload.thinking) && payload.thinking.type !== undefined) info.thinking = payload.thinking.type;
        if (isPlainObject(payload.output_config) && payload.output_config.effort !== undefined) info.output_config_effort = payload.output_config.effort;
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
      if (stats.authorNoteSource) console.log(`authorNoteSource: ${stats.authorNoteSource}`);
      if (stats.chatLoreSource) console.log(`chatLoreSource: ${stats.chatLoreSource}`);
      if (stats.currentChatError) console.log(`currentChatError: ${stats.currentChatError}`);
      console.log(`loreCandidates: ${stats.loreCandidates}`);
      console.log(`activeLorebooks: ${stats.activeLorebooks}`);
      if (stats.loreMatchMode) console.log(`loreMatchMode: ${stats.loreMatchMode}`);
      if (stats.loreScanWindow) console.log(`loreScanWindow: ${stats.loreScanWindow}`);
      if (stats.loreRecursiveMatches) console.log(`loreRecursiveMatches: ${stats.loreRecursiveMatches}`);
      if (stats.moduleLoreCandidates !== undefined) console.log(`moduleLoreCandidates: ${stats.moduleLoreCandidates}`);
      if (console.groupEnd) console.groupEnd();
    }

    function getAuxRequestBypassReason(messages, type, conf) {
      if (!conf?.bypassAuxRequests) return '';
      const requestType = String(type || '').trim().toLowerCase();
      const auxTypes = new Set(['memory', 'emotion', 'translate', 'otherax', 'submodel', 'sub-model']);
      if (auxTypes.has(requestType)) return `auxiliary request (${requestType})`;
      if (Array.isArray(messages) && messages.some(msg => containsLbProcess(msg?.content))) {
        return '<lb-process> helper request';
      }
      return '';
    }

    function containsLbProcess(value) {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return /<\/?\s*lb-process\b/i.test(value);
      if (Array.isArray(value)) return value.some(containsLbProcess);
      if (typeof value === 'object') return Object.values(value).some(containsLbProcess);
      return /<\/?\s*lb-process\b/i.test(String(value));
    }

    // ── beforeRequest / afterRequest 훅 등록 ─────────────────────────────────

    await Risuai.addRisuReplacer('beforeRequest', async (messages, type) => {
      try {
        const conf = await getConfig();
        const bypassReason = getAuxRequestBypassReason(messages, type, conf);
        if (bypassReason) {
          if (conf.debugLog) console.log(`Agents! bypassed: ${bypassReason}`);
          return messages;
        }

        const pipeline = await getPipelineConfig(conf);
        const runScope = await getAgentMemoryScope(conf.debugLog);
        const chatContext = await loadActualChatContext(messages, conf.debugLog);
        const runContext = await buildPipelineRunContext(messages, chatContext, conf, pipeline);
        const settingBlocks = runContext.settingBlocks;
        const runLogEnabled = isRunLogEnabled(conf);
        const preReuseKey = runLogEnabled
          ? buildPreReuseKey(runScope, chatContext, settingBlocks, pipeline, conf, runContext.cbsContext, runContext.globalNoteReplacement)
          : '';
        const previousRun = runLogEnabled ? await loadRunLogForScope(runScope, conf.debugLog) : null;
        const reusableRun = findReusablePreRun(previousRun, preReuseKey);

        if (reusableRun) {
          lastPipelineRun = createPreReusedRunLog(type, pipeline, conf, runScope, chatContext, settingBlocks, reusableRun, preReuseKey, runContext.globalNoteReplacement);
          lastPipelineRun.cbsContext = runContext.cbsContext;
          lastPipelineRun.cbsContextHash = hashAgentCbsContext(runContext.cbsContext);
          lastPipelineRun.cbsWarnings = mergeAgentCbsWarnings(lastPipelineRun.cbsWarnings || []);
          const injectedMessages = injectAgentNotes(messages, lastPipelineRun.notes);
          await persistRunLog(lastPipelineRun, conf.debugLog, conf.runLogEnabled);
          if (conf.debugLog) {
            console.log(`Agents! debug: pre-agent results reused from ${lastPipelineRun.preReusedFrom || '(unknown time)'}`);
            logPromptFlow('Agents! debug: messages sent to main LLM after pre-agent reuse', injectedMessages, true);
          }
          return injectedMessages;
        }

        if (!hasUsableProviderKeyForRows(pipeline, conf, 0, MAIN_ROW_INDEX - 1)
          && !hasMissingModelPresetForRows(pipeline, conf, 0, MAIN_ROW_INDEX - 1)) {
          console.log('Agents!: provider API key not set — pre-agent pipeline skipped');
          lastPipelineRun = createRunLogBase(type, pipeline, conf, runScope, 'skipped', 'pre-agent provider API key not set');
          lastPipelineRun.userInput = getUserInput(chatContext.messages);
          lastPipelineRun.settingBlocks = settingBlocks.content;
          lastPipelineRun.settingBlockStats = settingBlocks.stats;
          lastPipelineRun.globalNoteReplacement = runContext.globalNoteReplacement;
          lastPipelineRun.cbsContext = runContext.cbsContext;
          lastPipelineRun.cbsContextHash = hashAgentCbsContext(runContext.cbsContext);
          lastPipelineRun.cbsWarnings = [];
          lastPipelineRun.preReuseKey = preReuseKey;
          lastPipelineRun.preReused = false;
          Object.assign(lastPipelineRun, runChatContextMeta(chatContext));
          await persistRunLog(lastPipelineRun, conf.debugLog, conf.runLogEnabled);
          return messages;
        }

        if (conf.debugLog) {
          console.log('Agents! debug: beforeRequest type =', type);
          logPromptFlow('Agents! debug: RisuAI original messages', messages, true);
          console.log(`Agents! debug: chat context source = ${chatContext.source}; available = ${chatContext.available}; messages = ${chatContext.messageCount}`);
          console.log(`Agents! debug: first message included = ${chatContext.firstMessageIncluded ? 'yes' : 'no'}; source = ${chatContext.firstMessageSource || '(none)'}`);
          console.log(`Agents! debug: basic CBS replacement = ${chatContext.placeholderReplacementApplied ? 'applied' : 'unchanged'}; user source = ${chatContext.placeholderUserSource || '(none)'}`);
          if (chatContext.firstMessageError) console.log(`Agents! debug: first message note = ${chatContext.firstMessageError}`);
          if (chatContext.error) console.log(`Agents! debug: chat context error = ${chatContext.error}`);
          logPromptFlow('Agents! debug: messages used by Agents! context', chatContext.messages, true);
          logTextBlock('Agents! debug: setting blocks passed to agents', settingBlocks.content);
          logSettingBlockStats(settingBlocks.stats);
          logTextBlock('Agents! debug: current user input passed to agents', getUserInput(chatContext.messages));
        }

        const notes = await runPrePipeline(messages, chatContext, conf, pipeline, settingBlocks, type, runScope, preReuseKey, runContext);
        const injectedMessages = injectAgentNotes(messages, notes);
        await persistRunLog(lastPipelineRun, conf.debugLog, conf.runLogEnabled);
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
        const bypassReason = getAuxRequestBypassReason(null, type, conf);
        if (bypassReason) {
          if (conf.debugLog) console.log(`Agents! afterRequest bypassed: ${bypassReason}`);
          return content;
        }
        if (!lastPipelineRun) return content;

        const pipeline = await getPipelineConfig(conf);
        const hasPostAgents = pipeline.rows
          .slice(MAIN_ROW_INDEX + 1)
          .some(row => (row.agents || []).some(agent => agent.enabled !== false));

        if (!hasPostAgents) {
          if (lastPipelineRun) {
            if (lastPipelineRun.status !== 'skipped' && lastPipelineRun.status !== 'pre-skipped' && lastPipelineRun.status !== 'pre-reused') lastPipelineRun.status = 'complete';
            if (isRunLogEnabled(conf)) lastPipelineRun.finalResponse = String(content ?? '');
            await persistRunLog(lastPipelineRun, conf.debugLog, conf.runLogEnabled);
            if (!isRunLogEnabled(conf)) lastPipelineRun = null;
          }
          return content;
        }

        if (!hasUsableProviderKeyForRows(pipeline, conf, MAIN_ROW_INDEX + 1, PIPELINE_ROW_COUNT - 1)
          && !hasMissingModelPresetForRows(pipeline, conf, MAIN_ROW_INDEX + 1, PIPELINE_ROW_COUNT - 1)) {
          console.log('Agents!: provider API key not set — post-agent pipeline skipped');
          if (lastPipelineRun) {
            lastPipelineRun.status = 'post-skipped';
            lastPipelineRun.reason = 'post-agent provider API key not set';
            if (isRunLogEnabled(conf)) lastPipelineRun.finalResponse = String(content ?? '');
            await persistRunLog(lastPipelineRun, conf.debugLog, conf.runLogEnabled);
            if (!isRunLogEnabled(conf)) lastPipelineRun = null;
          }
          return content;
        }

        if (conf.debugLog) {
          console.log('Agents! debug: afterRequest type =', type);
          logTextBlock('Agents! debug: main model response before post-agents', content);
        }

        const finalContent = await runPostPipeline(content, conf, pipeline, type);
        await persistRunLog(lastPipelineRun, conf.debugLog, conf.runLogEnabled);
        if (!isRunLogEnabled(conf)) lastPipelineRun = null;
        if (conf.debugLog) logTextBlock('Agents! debug: final response after post-agents', finalContent);
        return finalContent;
      } catch (err) {
        console.log(`Agents! afterRequest pipeline error: ${err.message}`);
        return content;
      }
    });

    console.log('Agents! v1.1.10 loaded');

  } catch (err) {
    console.log(`Agents! init error: ${err.message}`);
  }
})();
