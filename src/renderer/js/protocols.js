export const PROTOCOL_ORDER = ['openai', 'anthropic', 'responses'];

export const PROTOCOLS = {
  openai: {
    short: 'ChatCompletions',
    full: 'OpenAI ChatCompletions',
    badge: 'Chat',
    path: '/v1/chat/completions',
    basePlaceholder: 'https://api.openai.com/v1',
    hint: '兼容 OpenAI、DeepSeek、Moonshot、Qwen、Ollama 等 ChatCompletions 接口',
    modelPlaceholder: '如 gpt-4o、deepseek-chat',
    modelHint: '模型 ID 由供应商定义，例如 gpt-4o、deepseek-chat、qwen-plus。'
  },
  anthropic: {
    short: 'Messages',
    full: 'Anthropic Messages',
    badge: 'Claude',
    path: '/v1/messages',
    basePlaceholder: 'https://api.anthropic.com',
    hint: '使用 x-api-key + anthropic-version，支持 Claude 官方与 Anthropic 兼容网关',
    modelPlaceholder: '如 claude-sonnet-4-5',
    modelHint: '填写 Claude 模型 ID，例如 claude-sonnet-4-5、claude-opus-4-1。'
  },
  responses: {
    short: 'Responses',
    full: 'OpenAI Responses API',
    badge: 'Responses',
    path: '/v1/responses',
    basePlaceholder: 'https://api.openai.com/v1',
    hint: 'OpenAI 新一代 Responses 接口，支持推理摘要与函数调用',
    modelPlaceholder: '如 gpt-5、o4-mini',
    modelHint: '填写 Responses API 模型 ID，例如 gpt-5、gpt-4.1、o4-mini。'
  }
};

export function protocolOf(value) {
  return PROTOCOLS[value] ? value : 'openai';
}

export function protocolMeta(value) {
  return PROTOCOLS[protocolOf(value)];
}

export function protocolCardsHtml(active = 'openai') {
  const current = protocolOf(active);
  return PROTOCOL_ORDER.map((id) => {
    const meta = PROTOCOLS[id];
    return `<button type="button" class="protocol-card ${id === current ? 'active' : ''}" data-protocol="${id}">
      <span class="pc-name">${meta.short}</span>
      <span class="pc-desc">${meta.path}</span>
    </button>`;
  }).join('');
}
