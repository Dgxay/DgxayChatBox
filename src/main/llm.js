'use strict';

/**
 * 多协议模型调用：
 *  - openai     OpenAI ChatCompletions（/v1/chat/completions，兼容大多数供应商）
 *  - anthropic  Anthropic Messages（/v1/messages）
 *  - responses  OpenAI Responses API（/v1/responses）
 *
 * 三种协议统一输出 { content, reasoning, toolCalls, usage, finishReason }，
 * 工具调用使用 OpenAI 风格的 { id, type, function: { name, arguments } }。
 */

const PROTOCOLS = ['openai', 'anthropic', 'responses'];

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function endpointFor(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('Base URL 不能为空');
  if (base.toLowerCase().endsWith(path.toLowerCase())) return base;
  if (/\/v\d+$/i.test(base)) return `${base}${path}`;
  return `${base}/v1${path}`;
}

function chatEndpoint(baseUrl, protocol = 'openai') {
  if (protocol === 'anthropic') return endpointFor(baseUrl, '/messages');
  if (protocol === 'responses') return endpointFor(baseUrl, '/responses');
  return endpointFor(baseUrl, '/chat/completions');
}

function modelsEndpoint(baseUrl) {
  return endpointFor(baseUrl, '/models');
}

function buildHeaders(apiKey, protocol, accept = 'text/event-stream') {
  const headers = {
    'Content-Type': 'application/json',
    Accept: accept,
    'User-Agent': 'DgxayChatBox/1.0'
  };
  const key = apiKey ? String(apiKey).trim() : '';
  if (protocol === 'anthropic') {
    if (key) {
      headers['x-api-key'] = key;
      headers.Authorization = `Bearer ${key}`;
    }
    headers['anthropic-version'] = '2023-06-01';
    return headers;
  }
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function readError(res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = json.error?.message || json.message || json.error || text;
    } catch {
      detail = text;
    }
  } catch {
    detail = '';
  }
  return `HTTP ${res.status} ${res.statusText}${detail ? ` · ${String(detail).slice(0, 600)}` : ''}`;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .join('');
  }
  return content == null ? '' : String(content);
}

function splitSystem(messages) {
  return messages
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content))
    .filter(Boolean)
    .join('\n\n');
}

/** 通用 SSE 读取：每条 data 交给 onData；忽略注释与 [DONE] */
async function consumeSSE(res, onData) {
  if (!res.body) throw new Error('当前网络响应不支持流式读取');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const handleBlock = (block) => {
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      onData(payload);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + (buffer[boundary] === '\r' ? 4 : 2));
      handleBlock(block);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  if (buffer.trim()) handleBlock(buffer);
}

function normalizeToolCalls(list) {
  return (list || [])
    .filter((call) => call?.id && call?.function?.name)
    .map((call) => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.function.name,
        arguments: call.function.arguments || '{}'
      }
    }));
}

/* ============================ OpenAI ChatCompletions ============================ */

async function streamOpenAI(options) {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    tools,
    temperature = 0.7,
    maxTokens = 4096,
    stream = true,
    signal,
    onDelta,
    onReasoning
  } = options;

  const body = {
    model,
    messages,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7,
    max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 4096,
    stream: Boolean(stream)
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(chatEndpoint(baseUrl, 'openai'), {
    method: 'POST',
    headers: buildHeaders(apiKey, 'openai'),
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw new Error(await readError(res));

  const toolCalls = [];
  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;

  if (!stream) {
    const json = await res.json();
    const choice = json.choices?.[0] || {};
    const message = choice.message || {};
    content = textOf(message.content);
    reasoning = message.reasoning_content || message.reasoning || '';
    if (content) onDelta?.(content);
    if (reasoning) onReasoning?.(reasoning);
    for (const call of message.tool_calls || []) {
      toolCalls.push({
        id: call.id || `call_${toolCalls.length}`,
        type: 'function',
        function: { name: call.function?.name || '', arguments: call.function?.arguments || '{}' }
      });
    }
    return {
      content,
      reasoning,
      toolCalls: normalizeToolCalls(toolCalls),
      usage: json.usage || null,
      finishReason: choice.finish_reason || null
    };
  }

  await consumeSSE(res, (payload) => {
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    if (json.error) throw new Error(json.error.message || '模型返回错误');
    const choice = json.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta || choice?.message || {};
    const reason = delta.reasoning_content ?? delta.reasoning;
    if (typeof reason === 'string' && reason) {
      reasoning += reason;
      onReasoning?.(reason);
    }
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onDelta?.(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        const index = Number.isInteger(part.index) ? part.index : toolCalls.length;
        if (!toolCalls[index]) {
          toolCalls[index] = { id: part.id || `call_${index}`, type: 'function', function: { name: '', arguments: '' } };
        }
        const target = toolCalls[index];
        if (part.id) target.id = part.id;
        if (part.function?.name) target.function.name += part.function.name;
        if (part.function?.arguments) target.function.arguments += part.function.arguments;
      }
    }
    if (json.usage) usage = json.usage;
  });

  return { content, reasoning, toolCalls: normalizeToolCalls(toolCalls), usage, finishReason };
}

/* ============================ Anthropic Messages ============================ */

function anthropicMessages(messages) {
  const out = [];
  let pendingToolResults = [];

  const flushToolResults = () => {
    if (!pendingToolResults.length) return;
    out.push({ role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (!message || message.role === 'system') continue;

    if (message.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: textOf(message.content)
      });
      continue;
    }

    flushToolResults();

    if (message.role === 'assistant') {
      const blocks = [];
      if (message.content) blocks.push({ type: 'text', text: textOf(message.content) });
      for (const call of message.tool_calls || []) {
        let input = {};
        try {
          input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          input = { raw: call.function?.arguments || '' };
        }
        blocks.push({
          type: 'tool_use',
          id: call.id || `tool_${blocks.length}`,
          name: call.function?.name || 'tool',
          input
        });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (message.role === 'user') {
      out.push({ role: 'user', content: textOf(message.content) });
    }
  }
  flushToolResults();

  // Anthropic 要求 user / assistant 交替出现，这里合并连续同角色消息
  const merged = [];
  for (const message of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      if (typeof last.content === 'string' && typeof message.content === 'string') {
        last.content = `${last.content}\n\n${message.content}`;
      } else {
        const left = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
        const right = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
        last.content = [...left, ...right];
      }
    } else {
      merged.push({ ...message });
    }
  }
  return merged;
}

async function streamAnthropic(options) {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    tools,
    temperature = 0.7,
    maxTokens = 4096,
    stream = true,
    signal,
    onDelta,
    onReasoning
  } = options;

  const system = splitSystem(messages);
  const body = {
    model,
    max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 4096,
    messages: anthropicMessages(messages),
    stream: Boolean(stream),
    temperature: Math.min(1, Math.max(0, Number(temperature) || 0.7))
  };
  if (system) body.system = system;
  if (tools?.length) {
    body.tools = tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters || { type: 'object', properties: {} }
    }));
  }

  const res = await fetch(chatEndpoint(baseUrl, 'anthropic'), {
    method: 'POST',
    headers: buildHeaders(apiKey, 'anthropic'),
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw new Error(await readError(res));

  if (!stream) {
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Anthropic 返回错误');
    let content = '';
    let reasoning = '';
    const toolCalls = [];
    for (const block of json.content || []) {
      if (block.type === 'text') content += block.text || '';
      if (block.type === 'thinking') reasoning += block.thinking || '';
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input || {}) }
        });
      }
    }
    if (content) onDelta?.(content);
    if (reasoning) onReasoning?.(reasoning);
    return {
      content,
      reasoning,
      toolCalls: normalizeToolCalls(toolCalls),
      usage: json.usage || null,
      finishReason: json.stop_reason || null
    };
  }

  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;
  const toolBlocks = new Map();

  await consumeSSE(res, (payload) => {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }

    switch (event.type) {
      case 'message_start':
        usage = event.message?.usage || usage;
        break;
      case 'content_block_start': {
        const block = event.content_block || {};
        if (block.type === 'text') {
          if (block.text) {
            content += block.text;
            onDelta?.(block.text);
          }
        } else if (block.type === 'thinking') {
          if (block.thinking) {
            reasoning += block.thinking;
            onReasoning?.(block.thinking);
          }
        } else if (block.type === 'tool_use') {
          toolBlocks.set(event.index, {
            id: block.id || `tool_${event.index}`,
            name: block.name || '',
            json: '',
            input: block.input
          });
        }
        break;
      }
      case 'content_block_delta': {
        const delta = event.delta || {};
        if (delta.type === 'text_delta' && delta.text) {
          content += delta.text;
          onDelta?.(delta.text);
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          reasoning += delta.thinking;
          onReasoning?.(delta.thinking);
        } else if (delta.type === 'input_json_delta') {
          const block = toolBlocks.get(event.index);
          if (block) block.json += delta.partial_json || '';
        }
        break;
      }
      case 'message_delta': {
        if (event.delta?.stop_reason) finishReason = event.delta.stop_reason;
        if (event.usage) usage = { ...(usage || {}), ...event.usage };
        break;
      }
      case 'error':
        throw new Error(event.error?.message || 'Anthropic 返回错误');
      default:
        break;
    }
  });

  const toolCalls = [...toolBlocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => ({
      id: block.id,
      type: 'function',
      function: {
        name: block.name,
        arguments: block.json || JSON.stringify(block.input || {})
      }
    }));

  return { content, reasoning, toolCalls: normalizeToolCalls(toolCalls), usage, finishReason };
}

/* ============================ OpenAI Responses API ============================ */

function responsesInput(messages) {
  const input = [];
  for (const message of messages) {
    if (!message || message.role === 'system') continue;
    if (message.role === 'user') {
      input.push({ role: 'user', content: textOf(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      if (message.content) input.push({ role: 'assistant', content: textOf(message.content) });
      for (const call of message.tool_calls || []) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function?.name || 'tool',
          arguments: call.function?.arguments || '{}'
        });
      }
      continue;
    }
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: textOf(message.content)
      });
    }
  }
  return input;
}

async function streamResponses(options) {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    tools,
    temperature = 0.7,
    maxTokens = 4096,
    stream = true,
    signal,
    onDelta,
    onReasoning
  } = options;

  const system = splitSystem(messages);
  const body = {
    model,
    input: responsesInput(messages),
    stream: Boolean(stream),
    // Responses 的推理模型通常不接受 temperature，交由服务端默认值
    max_output_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 4096
  };
  if (system) body.instructions = system;
  if (tools?.length) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters || { type: 'object', properties: {} }
    }));
    body.tool_choice = 'auto';
  }

  const res = await fetch(chatEndpoint(baseUrl, 'responses'), {
    method: 'POST',
    headers: buildHeaders(apiKey, 'responses'),
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw new Error(await readError(res));

  const collectOutput = (json) => {
    let text = '';
    let thought = '';
    const calls = [];
    for (const item of json.output || []) {
      if (item.type === 'message') {
        for (const part of item.content || []) {
          if (part.type === 'output_text' || part.type === 'text') text += part.text || '';
          if (part.type === 'refusal') text += part.refusal || '';
        }
      } else if (item.type === 'reasoning') {
        for (const part of item.summary || []) thought += part.text || '';
      } else if (item.type === 'function_call') {
        calls.push({
          id: item.call_id || item.id,
          type: 'function',
          function: { name: item.name, arguments: item.arguments || '{}' }
        });
      }
    }
    if (!text && json.output_text) text = json.output_text;
    return { text, thought, calls };
  };

  if (!stream) {
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Responses 返回错误');
    const { text, thought, calls } = collectOutput(json);
    if (text) onDelta?.(text);
    if (thought) onReasoning?.(thought);
    return {
      content: text,
      reasoning: thought,
      toolCalls: normalizeToolCalls(calls),
      usage: json.usage || null,
      finishReason: json.status || null
    };
  }

  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;
  const calls = new Map();

  await consumeSSE(res, (payload) => {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }

    switch (event.type) {
      case 'response.output_text.delta':
        if (event.delta) {
          content += event.delta;
          onDelta?.(event.delta);
        }
        break;
      case 'response.refusal.delta':
        if (event.delta) {
          content += event.delta;
          onDelta?.(event.delta);
        }
        break;
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (event.delta) {
          reasoning += event.delta;
          onReasoning?.(event.delta);
        }
        break;
      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          calls.set(event.item.id, {
            id: event.item.call_id || event.item.id,
            name: event.item.name || '',
            arguments: event.item.arguments || ''
          });
        }
        break;
      case 'response.function_call_arguments.delta': {
        const call = calls.get(event.item_id);
        if (call) call.arguments += event.delta || '';
        break;
      }
      case 'response.function_call_arguments.done': {
        const call = calls.get(event.item_id);
        if (call && event.arguments) call.arguments = event.arguments;
        break;
      }
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          const existing = calls.get(event.item.id) || {
            id: event.item.call_id || event.item.id,
            name: event.item.name || '',
            arguments: ''
          };
          if (event.item.arguments) existing.arguments = event.item.arguments;
          calls.set(event.item.id, existing);
        }
        break;
      case 'response.completed':
        usage = event.response?.usage || usage;
        finishReason = event.response?.status || 'completed';
        break;
      case 'response.failed':
        throw new Error(event.response?.error?.message || 'Responses 请求失败');
      case 'error':
        throw new Error(event.error?.message || 'Responses 返回错误');
      default:
        break;
    }
  });

  const toolCalls = [...calls.values()].map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments || '{}' }
  }));

  return { content, reasoning, toolCalls: normalizeToolCalls(toolCalls), usage, finishReason };
}

/* ============================ 对外接口 ============================ */

async function streamChat(options) {
  const protocol = PROTOCOLS.includes(options.protocol) ? options.protocol : 'openai';
  if (!options.model) throw new Error('未选择模型');
  if (!Array.isArray(options.messages) || !options.messages.length) throw new Error('消息不能为空');
  if (protocol === 'anthropic') return streamAnthropic(options);
  if (protocol === 'responses') return streamResponses(options);
  return streamOpenAI(options);
}

async function listModels({ baseUrl, apiKey, protocol = 'openai', signal }) {
  const res = await fetch(modelsEndpoint(baseUrl), {
    method: 'GET',
    headers: buildHeaders(apiKey, protocol, 'application/json'),
    signal
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return rows
    .map((row) => (typeof row === 'string' ? row : row?.id || row?.name))
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
}

module.exports = {
  streamChat,
  listModels,
  chatEndpoint,
  modelsEndpoint,
  PROTOCOLS
};
