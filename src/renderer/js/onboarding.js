import { state, emit, providers } from './store.js';
import { $, $$, escapeHtml, toast } from './ui.js';
import { icons } from './icons.js';
import { refreshAll } from './chat.js';
import { PROTOCOLS, PROTOCOL_ORDER, protocolMeta, protocolOf, protocolCardsHtml } from './protocols.js';

const PRESETS = [
  { name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { name: 'OpenAI Responses', protocol: 'responses', baseUrl: 'https://api.openai.com/v1' },
  { name: '通义千问', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: 'Ollama 本地', protocol: 'openai', baseUrl: 'http://localhost:11434/v1' }
];

const draft = {
  step: 1,
  protocol: 'openai',
  name: '我的模型',
  baseUrl: '',
  apiKey: '',
  models: [{ id: '', name: '' }]
};

export function initOnboarding() {
  draft.step = 1;
  draft.protocol = 'openai';
  draft.name = '我的模型';
  draft.baseUrl = '';
  draft.apiKey = '';
  draft.models = [{ id: '', name: '' }];

  const existing = providers();
  if (existing.length) {
    const first = existing[0];
    draft.protocol = protocolOf(first.protocol);
    draft.name = first.name || draft.name;
    draft.baseUrl = first.baseUrl || '';
    draft.apiKey = first.apiKey || '';
    draft.models = (first.models || []).map((m) => ({ id: m.id, name: m.name || '' }));
    if (!draft.models.length) draft.models = [{ id: '', name: '' }];
  }

  $('#onboard').hidden = false;
  renderStep();
}

function renderStep() {
  $('#obSteps').innerHTML = `<i class="${draft.step === 1 ? 'active' : ''}"></i><i class="${draft.step === 2 ? 'active' : ''}"></i>`;
  if (draft.step === 1) renderStepOne();
  else renderStepTwo();
}

function renderStepOne() {
  const configPath = state.info?.paths?.config || '~/.dcb/config.json';
  const meta = protocolMeta(draft.protocol);

  $('#obBody').innerHTML = `
    <h1 class="ob-title">连接你的第一个模型</h1>
    <p class="ob-sub">选择接口协议并填入地址与密钥。密钥只会保存在本机，不会上传到任何服务器。</p>

    <div class="field">
      <label>接口协议 <span class="hint">决定请求路径与消息格式</span></label>
      <div class="protocol-grid" id="obProtocols">${protocolCardsHtml(draft.protocol)}</div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 16px">
      ${PRESETS.map(
        (preset) =>
          `<button type="button" class="fetched-chip" data-preset="${escapeHtml(preset.baseUrl)}" data-name="${escapeHtml(preset.name)}" data-protocol="${preset.protocol}">${escapeHtml(preset.name)}</button>`
      ).join('')}
    </div>

    <div class="field">
      <label>供应商名称</label>
      <input class="input" id="obName" value="${escapeHtml(draft.name)}" placeholder="例如 DeepSeek" />
    </div>
    <div class="field">
      <label>Base URL <span class="hint">${meta.path}</span></label>
      <input class="input mono" id="obBase" value="${escapeHtml(draft.baseUrl)}" placeholder="${meta.basePlaceholder}" spellcheck="false" />
      <p class="input-hint" id="obBaseHint">${escapeHtml(meta.hint)}</p>
    </div>
    <div class="field">
      <label>API Key <span class="hint">仅保存在本地</span></label>
      <input class="input mono" id="obKey" type="password" value="${escapeHtml(draft.apiKey)}" placeholder="sk-..." spellcheck="false" />
    </div>

    <div class="ob-tip">
      ${icons.shield}
      <span>配置会写入 <b>${escapeHtml(configPath)}</b>。本地模型（如 Ollama）或内网网关可以留空 API Key。</span>
    </div>
    <div class="form-error" id="obErr"></div>

    <div class="ob-dir">${icons.folder}<span>首次启动会创建 ${escapeHtml(state.info?.paths?.dataDir || '~/.dcb')}</span></div>
  `;

  $('#obFoot').innerHTML = `
    <span class="ob-provider-preview"><span class="dot"></span>${escapeHtml(meta.full)} · 支持多供应商</span>
    <span class="spacer"></span>
    <button class="btn btn-primary" id="obNext">下一步</button>
  `;

  $$('#obBody .protocol-card').forEach((card) => {
    card.addEventListener('click', () => selectProtocol(card.dataset.protocol));
  });

  $$('#obBody [data-preset]').forEach((chip) => {
    chip.addEventListener('click', () => {
      selectProtocol(chip.dataset.protocol);
      $('#obName').value = chip.dataset.name;
      $('#obBase').value = chip.dataset.preset;
      $('#obKey').focus();
    });
  });

  $('#obNext').addEventListener('click', () => {
    const name = $('#obName').value.trim();
    const baseUrl = $('#obBase').value.trim();
    const apiKey = $('#obKey').value.trim();
    const err = $('#obErr');
    if (!/^https?:\/\//i.test(baseUrl)) {
      err.textContent = '请填写以 http:// 或 https:// 开头的 Base URL';
      return;
    }
    draft.name = name || '我的供应商';
    draft.baseUrl = baseUrl;
    draft.apiKey = apiKey;
    draft.step = 2;
    renderStep();
  });

  ['obName', 'obBase', 'obKey'].forEach((id) => {
    $(`#${id}`).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        $('#obNext')?.click();
      }
    });
  });
}

function selectProtocol(value) {
  const protocol = protocolOf(value);
  draft.protocol = protocol;
  $$('#obBody .protocol-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.protocol === protocol);
  });

  const meta = PROTOCOLS[protocol];
  const baseInput = $('#obBase');
  if (!baseInput) return;

  baseInput.placeholder = meta.basePlaceholder;
  $('#obBaseHint').textContent = meta.hint;
  const labelHint = baseInput.closest('.field')?.querySelector('.hint');
  if (labelHint) labelHint.textContent = meta.path;

  const current = baseInput.value.trim();
  const isDefault = PROTOCOL_ORDER.some((id) => PROTOCOLS[id].basePlaceholder === current);
  if (!current || isDefault) baseInput.value = meta.basePlaceholder;
}

function renderStepTwo() {
  const meta = protocolMeta(draft.protocol);

  $('#obBody').innerHTML = `
    <h1 class="ob-title">添加模型</h1>
    <p class="ob-sub">当前协议：<b>${escapeHtml(meta.full)}</b>。同一供应商下可以添加多个模型，之后在输入框右下角随时切换。</p>
    <div class="field">
      <label>模型列表 <span class="hint">第一行会作为默认模型</span></label>
      <div id="obModels">${draft.models.map((m) => modelRow(m, meta.modelPlaceholder)).join('')}</div>
      <button class="ob-add-model" id="obAddModel">${icons.plus}<span>再添加一个模型</span></button>
    </div>
    <div class="ob-tip">
      ${icons.key}
      <span>${escapeHtml(meta.modelHint)}</span>
    </div>
    <div class="form-error" id="obErr"></div>
  `;

  $('#obFoot').innerHTML = `
    <button class="btn btn-ghost" id="obBack">上一步</button>
    <span class="spacer"></span>
    <button class="btn btn-primary" id="obFinish">完成设置</button>
  `;

  $('#obAddModel').addEventListener('click', () => {
    $('#obModels').insertAdjacentHTML('beforeend', modelRow({ id: '', name: '' }, meta.modelPlaceholder));
    const rows = $$('#obModels .ob-model-row');
    rows[rows.length - 1].querySelector('input').focus();
  });

  $('#obModels').addEventListener('click', (event) => {
    const btn = event.target.closest('.ob-remove');
    if (!btn) return;
    const rows = $$('#obModels .ob-model-row');
    if (rows.length <= 1) {
      rows[0].querySelectorAll('input').forEach((input) => (input.value = ''));
      return;
    }
    btn.closest('.ob-model-row').remove();
  });

  $('#obBack').addEventListener('click', () => {
    syncModels();
    draft.step = 1;
    renderStep();
  });

  $('#obFinish').addEventListener('click', finish);

  $('#obModels').querySelectorAll('input[data-model-id]').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      }
    });
  });
}

function modelRow(model, placeholder) {
  return `<div class="ob-model-row">
    <input class="input mono" data-model-id value="${escapeHtml(model.id || '')}" placeholder="${escapeHtml(placeholder || '模型 ID')}" spellcheck="false" />
    <input class="input" data-model-name value="${escapeHtml(model.name || '')}" placeholder="显示名称（可选）" />
    <button class="ob-remove" type="button" title="移除">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>`;
}

function syncModels() {
  const models = $$('#obModels .ob-model-row')
    .map((row) => ({
      id: row.querySelector('[data-model-id]').value.trim(),
      name: row.querySelector('[data-model-name]').value.trim()
    }))
    .filter((m) => m.id);
  draft.models = models.length ? models : [{ id: '', name: '' }];
}

async function finish() {
  const models = $$('#obModels .ob-model-row')
    .map((row) => ({
      id: row.querySelector('[data-model-id]').value.trim(),
      name: row.querySelector('[data-model-name]').value.trim()
    }))
    .filter((m) => m.id);

  const err = $('#obErr');
  if (!models.length) {
    err.textContent = '请至少填写一个模型 ID';
    return;
  }

  const unique = [];
  models.forEach((m) => {
    if (!unique.find((u) => u.id === m.id)) unique.push({ id: m.id, name: m.name || m.id });
  });

  const provider = {
    id: `prov_${Date.now().toString(36)}`,
    name: draft.name || '我的供应商',
    protocol: protocolOf(draft.protocol),
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    models: unique
  };

  const existing = providers().filter((p) => !(p.baseUrl === provider.baseUrl && p.name === provider.name));

  try {
    const config = await window.dcb.saveConfig({
      onboarded: true,
      providers: [...existing, provider],
      activeProviderId: provider.id,
      activeModelId: unique[0].id,
      ui: { ...(state.config?.ui || {}), mode: 'chat', permission: 'normal' }
    });
    state.config = config;
    emit('config', { patch: {} });
    $('#onboard').hidden = true;
    refreshAll();
    toast('配置已保存，开始对话吧');
    $('#input')?.focus();
  } catch (error) {
    err.textContent = error.message || '保存失败，请检查目录权限';
  }
}
