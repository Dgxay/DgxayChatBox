import {
  state,
  providers,
  activeProvider,
  activeModel,
  patchConfig,
  setActiveModel,
  emit,
  on,
  PERMISSIONS
} from './store.js';
import { $, $$, escapeHtml, toast, openModal, confirmDialog, accelFromEvent, uid } from './ui.js';
import { icons } from './icons.js';
import { refreshAll, refreshChrome } from './chat.js';
import { PROTOCOLS, PROTOCOL_ORDER, protocolMeta, protocolOf, protocolCardsHtml } from './protocols.js';

const TABS = {
  providers: {
    title: '供应商与模型',
    desc: '支持 ChatCompletions、Anthropic Messages 与 Responses 三种协议，添加多个模型后可在输入框右侧随时切换。'
  },
  shortcuts: {
    title: '快捷键',
    desc: '为常用操作绑定顺手的组合键。点击按键框后直接按下新的组合键即可。'
  },
  general: {
    title: '通用设置',
    desc: '发送方式、生成参数与界面偏好，都会即时保存到本地配置。'
  },
  data: {
    title: '数据与关于',
    desc: '所有配置与对话记录都保存在本机用户目录，不会上传到第三方服务器。'
  }
};

let currentTab = 'providers';
let recordingKey = null;

/* ------------------------------ 打开 / 关闭 ------------------------------ */

export function openSettings(tab = 'providers') {
  state.settingsOpen = true;
  $('#settingsView').hidden = false;
  $('#chatView').hidden = true;
  renderTab(tab);
}

export function closeSettings() {
  if (recordingKey) stopRecording();
  state.settingsOpen = false;
  $('#settingsView').hidden = true;
  $('#chatView').hidden = false;
  refreshAll();
  $('#input')?.focus();
}

export function initSettings() {
  $('#setBack').addEventListener('click', closeSettings);
  $$('#setNav button').forEach((btn) => {
    btn.addEventListener('click', () => renderTab(btn.dataset.tab));
  });
  on('open-settings', (event) => openSettings(event.detail?.tab || 'providers'));
  on('chat-changed', () => {
    if (state.settingsOpen) closeSettings();
  });
  on('config', () => {
    if (state.settingsOpen && !recordingKey && !document.querySelector('.modal')) {
      // 外部配置变化时保持界面同步（避免打断输入）
      const active = document.activeElement;
      const editing = active && $('#settingsView').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
      if (!editing) renderTab(currentTab);
    }
  });
}

function renderTab(tab) {
  if (!TABS[tab]) tab = 'providers';
  currentTab = tab;
  state.settingsTab = tab;
  $$('#setNav button').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  $('#setTitle').textContent = TABS[tab].title;
  $('#setDesc').textContent = TABS[tab].desc;

  if (tab === 'providers') renderProviders();
  else if (tab === 'shortcuts') renderShortcuts();
  else if (tab === 'general') renderGeneral();
  else renderData();
}

/* ------------------------------ 供应商 ------------------------------ */

function renderProviders() {
  const list = providers();
  const active = activeProvider();
  const defaultModel = state.config.activeModelId;

  const cards = list
    .map((provider) => {
      const models = provider.models || [];
      const isActive = active && active.id === provider.id;
      return `
      <div class="card" data-provider="${provider.id}">
        <div class="card-head">
          <div style="min-width:0">
            <div class="card-title">
              <span class="provider-dot" style="${isActive ? '' : 'background:#c9c2b6'}"></span>
              ${escapeHtml(provider.name || '未命名供应商')}
              <span class="protocol-badge">${escapeHtml(protocolMeta(provider.protocol).short)}</span>
              ${isActive ? '<span class="model-tag default" style="margin-left:4px">当前</span>' : ''}
            </div>
            <p class="card-sub">${escapeHtml(provider.baseUrl)}</p>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm" data-act="edit">编辑</button>
            <button class="btn btn-sm btn-danger" data-act="delete">删除</button>
          </div>
        </div>
        <div class="model-tags">
          ${models
            .map(
              (model) => `<button class="model-tag ${model.id === defaultModel && isActive ? 'default' : ''}" data-model="${escapeHtml(model.id)}" title="切换到这个模型">
                ${escapeHtml(model.name || model.id)}
                ${model.name && model.name !== model.id ? `<span class="mt-badge">${escapeHtml(model.id)}</span>` : ''}
              </button>`
            )
            .join('')}
          ${!models.length ? '<span class="hint" style="font-size:11.5px;color:var(--text-3)">还没有模型，点击编辑添加</span>' : ''}
        </div>
        <div class="provider-meta">
          <span>协议：<b>${escapeHtml(protocolMeta(provider.protocol).full)}</b></span>
          <span>API Key：<b>${escapeHtml(maskKey(provider.apiKey))}</b></span>
          <span>模型：<b>${models.length}</b> 个</span>
        </div>
      </div>`;
    })
    .join('');

  $('#setBody').innerHTML = `
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
      <div>
        <div class="card-title">已连接 ${list.length} 个供应商</div>
        <p class="card-sub" style="font-family:inherit">密钥仅保存在本机 ~/.dcb/config.json</p>
      </div>
      <button class="btn btn-primary" id="btnAddProvider">
        ${icons.plus}<span>新增供应商</span>
      </button>
    </div>
    ${
      list.length
        ? cards
        : `<div class="empty-card">
            <div class="ec-icon">${icons.key}</div>
            <h3>还没有供应商</h3>
            <p>添加一个模型接口即可开始对话，支持三种主流协议</p>
            <button class="btn btn-primary" id="btnAddProviderEmpty">新增供应商</button>
          </div>`
    }
  `;

  const openNew = () => openProviderEditor(null);
  $('#btnAddProvider')?.addEventListener('click', openNew);
  $('#btnAddProviderEmpty')?.addEventListener('click', openNew);

  $$('#setBody [data-provider]').forEach((card) => {
    const provider = providers().find((p) => p.id === card.dataset.provider);
    if (!provider) return;
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openProviderEditor(provider));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => removeProvider(provider));
    card.querySelectorAll('[data-model]').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const modelId = chip.dataset.model;
        await setActiveModel(provider.id, modelId);
        renderProviders();
        toast(`已切换到 ${modelId}`);
      });
    });
  });
}

function maskKey(key) {
  if (!key) return '未填写（可留空）';
  const str = String(key);
  if (str.length <= 8) return '••••••••';
  return `${str.slice(0, 3)}••••••${str.slice(-4)}`;
}

function providerRow(id = '', name = '') {
  return `<div class="model-row">
    <input class="input mono" data-field="id" value="${escapeHtml(id)}" placeholder="模型 ID，如 gpt-4o" spellcheck="false" />
    <input class="input" data-field="name" value="${escapeHtml(name)}" placeholder="显示名称（可选）" />
    <button class="mr-del" type="button" title="移除">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>`;
}

function openProviderEditor(provider) {
  const editing = Boolean(provider);
  const draft = provider
    ? JSON.parse(JSON.stringify(provider))
    : { id: uid('prov'), name: '', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: [] };
  draft.protocol = protocolOf(draft.protocol);
  if (!draft.models?.length) draft.models = [{ id: '', name: '' }];
  let selectedProtocol = draft.protocol;

  const protocolMetaInfo = PROTOCOLS[draft.protocol];
  const body = `
    <div class="field">
      <label>接口协议 <span class="hint" id="pvBasePath">${protocolMetaInfo.path}</span></label>
      <div class="protocol-grid compact" id="pvProtocols">${protocolCardsHtml(draft.protocol)}</div>
    </div>
    <div class="field">
      <label>供应商名称</label>
      <input class="input" id="pvName" value="${escapeHtml(draft.name)}" placeholder="例如 DeepSeek" />
    </div>
    <div class="field">
      <label>Base URL <span class="hint">可只填域名，也会自动补全路径</span></label>
      <input class="input mono" id="pvBase" value="${escapeHtml(draft.baseUrl)}" placeholder="${protocolMetaInfo.basePlaceholder}" spellcheck="false" />
      <p class="input-hint" id="pvBaseHint">${escapeHtml(protocolMetaInfo.hint)}</p>
    </div>
    <div class="field">
      <label>API Key <span class="hint">仅保存在本地</span></label>
      <div style="display:flex;gap:8px">
        <input class="input mono" id="pvKey" type="password" value="${escapeHtml(draft.apiKey)}" placeholder="sk-..." spellcheck="false" style="flex:1" />
        <button class="btn" type="button" id="pvReveal">显示</button>
      </div>
    </div>
    <div class="field">
      <label>模型列表 <span class="hint">可添加多个，对话时随时切换</span></label>
      <div class="model-row-head"><span>模型 ID</span><span>显示名称</span><span></span></div>
      <div class="model-rows" id="pvModels">${draft.models.map((m) => providerRow(m.id, m.name)).join('')}</div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:9px;flex-wrap:wrap">
        <button class="btn btn-sm" type="button" id="pvAddModel">+ 添加模型</button>
        <button class="btn btn-sm" type="button" id="pvFetch">拉取模型列表</button>
        <span class="hint" id="pvFetchHint" style="font-size:11px;color:var(--text-3)"></span>
      </div>
      <div class="fetched-models" id="pvFetched"></div>
    </div>
    <div class="form-error" id="pvErr"></div>
  `;

  openModal({
    title: editing ? '编辑供应商' : '新增供应商',
    desc: '支持 OpenAI ChatCompletions、Anthropic Messages 与 OpenAI Responses 三种协议，按供应商实际接口选择。',
    width: 'wide',
    body,
    actions: [
      { label: '取消', value: false },
      {
        label: editing ? '保存修改' : '添加供应商',
        variant: 'primary',
        onClick: async () => {
          const errEl = $('#pvErr');
          const name = $('#pvName').value.trim() || '我的供应商';
          const baseUrl = $('#pvBase').value.trim().replace(/\/+$/, '');
          const apiKey = $('#pvKey').value.trim();
          const protocol = protocolOf(selectedProtocol);
          const models = $$('#pvModels .model-row')
            .map((row) => ({
              id: row.querySelector('[data-field="id"]').value.trim(),
              name: row.querySelector('[data-field="name"]').value.trim()
            }))
            .filter((m) => m.id)
            .map((m) => ({ id: m.id, name: m.name || m.id }));

          if (!/^https?:\/\//i.test(baseUrl)) {
            errEl.textContent = '请填写以 http:// 或 https:// 开头的 Base URL';
            return false;
          }
          if (!models.length) {
            errEl.textContent = '请至少添加一个模型 ID';
            return false;
          }
          const unique = [];
          models.forEach((m) => {
            if (!unique.find((u) => u.id === m.id)) unique.push(m);
          });

          const next = providers().map((p) =>
            p.id === draft.id ? { ...p, name, protocol, baseUrl, apiKey, models: unique } : p
          );
          if (!editing) next.push({ id: draft.id, name, protocol, baseUrl, apiKey, models: unique });

          const patch = { providers: next };
          if (!editing && !state.config.activeProviderId) {
            patch.activeProviderId = draft.id;
            patch.activeModelId = unique[0].id;
          }
          if (editing && state.config.activeProviderId === draft.id) {
            const activeExists = unique.find((m) => m.id === state.config.activeModelId);
            if (!activeExists) patch.activeModelId = unique[0].id;
          }
          await patchConfig(patch);
          return true;
        }
      }
    ],
    onMount: (bodyEl) => {
      const protocolGrid = bodyEl.querySelector('#pvProtocols');
      protocolGrid.addEventListener('click', (event) => {
        const card = event.target.closest('[data-protocol]');
        if (!card) return;
        selectedProtocol = protocolOf(card.dataset.protocol);
        const meta = PROTOCOLS[selectedProtocol];
        protocolGrid.querySelectorAll('.protocol-card').forEach((item) => {
          item.classList.toggle('active', item === card);
        });
        const baseInput = bodyEl.querySelector('#pvBase');
        const current = baseInput.value.trim();
        const isDefault = PROTOCOL_ORDER.some((id) => PROTOCOLS[id].basePlaceholder === current);
        if (!current || isDefault) baseInput.value = meta.basePlaceholder;
        baseInput.placeholder = meta.basePlaceholder;
        bodyEl.querySelector('#pvBasePath').textContent = meta.path;
        bodyEl.querySelector('#pvBaseHint').textContent = meta.hint;
        bodyEl.querySelectorAll('#pvModels [data-field="id"]').forEach((input) => {
          input.placeholder = meta.modelPlaceholder;
        });
      });

      bodyEl.querySelector('#pvAddModel').addEventListener('click', () => {
        bodyEl.querySelector('#pvModels').insertAdjacentHTML('beforeend', providerRow());
        bodyEl.querySelector('#pvModels').lastElementChild.querySelector('input').focus();
      });

      bodyEl.querySelector('#pvModels').addEventListener('click', (event) => {
        const del = event.target.closest('.mr-del');
        if (!del) return;
        const rows = bodyEl.querySelectorAll('#pvModels .model-row');
        if (rows.length <= 1) {
          rows[0].querySelectorAll('input').forEach((input) => (input.value = ''));
          return;
        }
        del.closest('.model-row').remove();
      });

      bodyEl.querySelector('#pvReveal').addEventListener('click', (event) => {
        const keyInput = bodyEl.querySelector('#pvKey');
        const show = keyInput.type === 'password';
        keyInput.type = show ? 'text' : 'password';
        event.currentTarget.textContent = show ? '隐藏' : '显示';
      });

      bodyEl.querySelector('#pvFetch').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const hint = bodyEl.querySelector('#pvFetchHint');
        const fetched = bodyEl.querySelector('#pvFetched');
        const baseUrl = bodyEl.querySelector('#pvBase').value.trim();
        const apiKey = bodyEl.querySelector('#pvKey').value.trim();
        btn.disabled = true;
        hint.textContent = '正在连接…';
        fetched.innerHTML = '';
        try {
          const models = await window.dcb.fetchModels({ baseUrl, apiKey, protocol: selectedProtocol });
          hint.textContent = models.length ? `发现 ${models.length} 个模型，点击添加` : '没有返回模型';
          fetched.innerHTML = models
            .slice(0, 60)
            .map((id) => `<button class="fetched-chip" type="button" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`)
            .join('');
          fetched.querySelectorAll('.fetched-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
              const existing = $$('#pvModels [data-field="id"]').some((input) => input.value.trim() === chip.dataset.id);
              if (existing) {
                toast('该模型已添加', 'warn');
                return;
              }
              const emptyRow = $$('#pvModels .model-row').find(
                (row) => !row.querySelector('[data-field="id"]').value.trim()
              );
              if (emptyRow) {
                emptyRow.querySelector('[data-field="id"]').value = chip.dataset.id;
              } else {
                $('#pvModels').insertAdjacentHTML('beforeend', providerRow(chip.dataset.id));
              }
            });
          });
        } catch (err) {
          hint.textContent = '';
          fetched.innerHTML = `<span style="font-size:11.5px;color:var(--danger)">${escapeHtml(err.message || '拉取失败')}</span>`;
        } finally {
          btn.disabled = false;
        }
      });
    }
  }).then(async (saved) => {
    if (!saved) return;
    renderProviders();
    refreshChrome();
    toast(editing ? '供应商已更新' : '供应商已添加');
  });
}

async function removeProvider(provider) {
  const ok = await confirmDialog({
    title: '删除这个供应商？',
    message: `「${escapeHtml(provider.name)}」及其 ${provider.models?.length || 0} 个模型配置将从本机删除，此操作不可恢复。`,
    confirmText: '删除'
  });
  if (!ok) return;

  const next = providers().filter((p) => p.id !== provider.id);
  const patch = { providers: next };
  if (state.config.activeProviderId === provider.id) {
    patch.activeProviderId = next[0]?.id || '';
    patch.activeModelId = next[0]?.models?.[0]?.id || '';
  }
  await patchConfig(patch);
  renderProviders();
  refreshChrome();
  toast('供应商已删除');
}

/* ------------------------------ 快捷键 ------------------------------ */

const SHORTCUT_ROWS = [
  { key: 'newChat', title: '新建对话', desc: '立即开启一个新会话' },
  { key: 'settings', title: '打开设置', desc: '跳转到供应商与模型设置' },
  { key: 'toggleMode', title: '切换模式', desc: '在对话模式与工作模式之间切换' },
  { key: 'focusInput', title: '聚焦输入框', desc: '光标回到消息输入框' }
];

function renderShortcuts() {
  const shortcuts = state.config.shortcuts || {};
  const rows = SHORTCUT_ROWS.map(
    (row) => `
    <div class="shortcut-row">
      <div>
        <div class="sk-title">${row.title}</div>
        <div class="sk-desc">${row.desc}</div>
      </div>
      <div style="display:flex;align-items:center">
        <button class="sk-record" data-key="${row.key}">${escapeHtml(shortcuts[row.key] || '未设置')}</button>
        <button class="sk-reset" data-reset="${row.key}" title="恢复默认">默认</button>
      </div>
    </div>`
  ).join('');

  const globalOn = Boolean(state.config.advanced?.globalShortcutEnabled);
  $('#setBody').innerHTML = `
    <div class="card">
      ${rows}
    </div>
    <div class="card">
      <div class="set-row">
        <div>
          <div class="sr-title">全局唤起窗口</div>
          <div class="sr-desc">即使窗口在后台，也能用组合键呼出 DgxayChatBox</div>
        </div>
        <div class="sr-control" style="display:flex;align-items:center;gap:10px">
          <button class="sk-record" data-key="globalShortcut">${escapeHtml(state.config.advanced?.globalShortcut || 'Ctrl+Shift+Space')}</button>
          <button class="switch ${globalOn ? 'on' : ''}" id="swGlobal" role="switch" aria-checked="${globalOn}" title="开启全局快捷键"></button>
        </div>
      </div>
      <div class="form-note" style="margin-top:12px">快捷键使用 Ctrl / Alt / Shift / Meta 组合，保存后立即生效。全局快捷键若被其他软件占用，可能注册失败。</div>
    </div>
  `;

  $$('#setBody .sk-record').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      startRecording(btn, btn.dataset.key);
    });
  });

  $$('#setBody .sk-reset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const defaults = {
        newChat: 'Ctrl+N',
        settings: 'Ctrl+,',
        toggleMode: 'Ctrl+Shift+M',
        focusInput: 'Ctrl+L',
        globalShortcut: 'Ctrl+Shift+Space'
      };
      const key = btn.dataset.reset;
      const next = key === 'globalShortcut'
        ? { advanced: { ...state.config.advanced, globalShortcut: defaults[key] } }
        : { shortcuts: { ...state.config.shortcuts, [key]: defaults[key] } };
      await patchConfig(next);
      renderShortcuts();
      toast('已恢复默认快捷键');
    });
  });

  $('#swGlobal').addEventListener('click', async (event) => {
    const on = !event.currentTarget.classList.contains('on');
    await patchConfig({ advanced: { ...state.config.advanced, globalShortcutEnabled: on } });
    renderShortcuts();
    if (on) {
      const status = await window.dcb.shortcutStatus?.();
      if (status && !status.registered) {
        toast('快捷键注册失败，可能已被其他程序占用', 'warn');
        return;
      }
    }
    toast(on ? '全局快捷键已开启' : '全局快捷键已关闭');
  });
}

function startRecording(btn, key) {
  if (recordingKey) return;
  recordingKey = key;
  state.recordingShortcut = true;
  const previous = btn.textContent;
  btn.classList.add('recording');
  btn.textContent = '请按下组合键…';

  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true);
    btn.classList.remove('recording');
    btn.textContent = previous;
    recordingKey = null;
    state.recordingShortcut = false;
  };

  const onKey = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      cleanup();
      return;
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    const accel = accelFromEvent(event);
    if (!accel || accel.split('+').length < 2) {
      btn.textContent = '请包含 Ctrl / Alt / Shift';
      return;
    }
    cleanup();
    const patch = key === 'globalShortcut'
      ? { advanced: { ...state.config.advanced, globalShortcut: accel } }
      : { shortcuts: { ...state.config.shortcuts, [key]: accel } };
    await patchConfig(patch);
    renderShortcuts();
    toast(`快捷键已设置为 ${accel}`);
  };

  window.addEventListener('keydown', onKey, true);
}

function stopRecording() {
  recordingKey = null;
  state.recordingShortcut = false;
}

/* ------------------------------ 通用 ------------------------------ */

function renderGeneral() {
  const cfg = state.config;
  const accent = cfg.ui?.accent || 'coral';

  $('#setBody').innerHTML = `
    <div class="card">
      <div class="set-row">
        <div>
          <div class="sr-title">发送方式</div>
          <div class="sr-desc">选择 Enter 还是 Ctrl + Enter 发送消息</div>
        </div>
        <div class="sr-control">
          <select class="input" id="setSendKey">
            <option value="enter" ${cfg.chat.enterToSend !== false ? 'selected' : ''}>Enter 发送</option>
            <option value="ctrl" ${cfg.chat.enterToSend === false ? 'selected' : ''}>Ctrl + Enter 发送</option>
          </select>
        </div>
      </div>
      <div class="set-row">
        <div>
          <div class="sr-title">流式输出</div>
          <div class="sr-desc">逐字显示模型回复，关闭后等待完整结果</div>
        </div>
        <div class="sr-control">
          <button class="switch ${cfg.chat.stream !== false ? 'on' : ''}" id="setStream" role="switch" aria-checked="${cfg.chat.stream !== false}"></button>
        </div>
      </div>
      <div class="set-row">
        <div>
          <div class="sr-title">温度</div>
          <div class="sr-desc">越低越稳定，越高越有创意</div>
        </div>
        <div class="sr-control slider-wrap">
          <input type="range" id="setTemp" min="0" max="2" step="0.1" value="${cfg.chat.temperature ?? 0.7}" />
          <span class="slider-value" id="tempValue">${Number(cfg.chat.temperature ?? 0.7).toFixed(1)}</span>
        </div>
      </div>
      <div class="set-row">
        <div>
          <div class="sr-title">最大回复长度</div>
          <div class="sr-desc">max_tokens，按模型上限调整</div>
        </div>
        <div class="sr-control">
          <input class="input narrow" id="setMaxTokens" type="number" min="256" max="128000" step="256" value="${cfg.chat.maxTokens ?? 4096}" />
        </div>
      </div>
      <div class="set-row">
        <div>
          <div class="sr-title">强调色</div>
          <div class="sr-desc">多巴胺色板，随心情切换</div>
        </div>
        <div class="sr-control">
          <div class="accent-swatches">
            ${[
              ['coral', '珊瑚红'],
              ['amber', '琥珀橙'],
              ['mint', '薄荷绿'],
              ['sky', '天空蓝']
            ]
              .map(([name, label]) => `<button class="swatch ${accent === name ? 'active' : ''}" data-accent="${name}" title="${label}" aria-label="${label}"></button>`)
              .join('')}
          </div>
        </div>
      </div>
      <div class="set-row">
        <div>
          <div class="sr-title">对话字号</div>
          <div class="sr-desc">调整消息与输入框的文字大小</div>
        </div>
        <div class="sr-control slider-wrap">
          <input type="range" id="setFont" min="0.9" max="1.2" step="0.05" value="${cfg.ui?.fontScale ?? 1}" />
          <span class="slider-value" id="fontValue">${Math.round((cfg.ui?.fontScale ?? 1) * 100)}%</span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:4px">系统提示词</div>
      <p class="sr-desc" style="margin:0 0 10px">会附加在所有对话的最前面，用来固定助手的角色与风格。</p>
      <textarea class="input" id="setSystem" placeholder="例如：你是一位严谨的技术文档工程师，回答尽量给出可执行的步骤。">${escapeHtml(cfg.chat.systemPrompt || '')}</textarea>
      <div class="form-note">当前模式：${cfg.ui.mode === 'work' ? '工作模式' : '对话模式'}。工作模式下还会自动附加工作空间与权限说明。</div>
    </div>
  `;

  $('#setSendKey').addEventListener('change', async (event) => {
    await patchConfig({ chat: { ...state.config.chat, enterToSend: event.target.value === 'enter' } });
    refreshChrome();
  });

  $('#setStream').addEventListener('click', async (event) => {
    const on = !event.currentTarget.classList.contains('on');
    event.currentTarget.classList.toggle('on', on);
    event.currentTarget.setAttribute('aria-checked', String(on));
    await patchConfig({ chat: { ...state.config.chat, stream: on } });
  });

  let tempTimer = null;
  $('#setTemp').addEventListener('input', (event) => {
    $('#tempValue').textContent = Number(event.target.value).toFixed(1);
    clearTimeout(tempTimer);
    tempTimer = setTimeout(() => patchConfig({ chat: { ...state.config.chat, temperature: Number(event.target.value) } }), 350);
  });

  $('#setMaxTokens').addEventListener('change', async (event) => {
    const value = Math.max(256, Math.min(128000, Number(event.target.value) || 4096));
    event.target.value = value;
    await patchConfig({ chat: { ...state.config.chat, maxTokens: value } });
  });

  let promptTimer = null;
  $('#setSystem').addEventListener('input', (event) => {
    clearTimeout(promptTimer);
    const value = event.target.value;
    promptTimer = setTimeout(() => patchConfig({ chat: { ...state.config.chat, systemPrompt: value } }), 600);
  });

  $$('#setBody .swatch').forEach((swatch) => {
    swatch.addEventListener('click', async () => {
      $$('#setBody .swatch').forEach((s) => s.classList.toggle('active', s === swatch));
      document.body.dataset.accent = swatch.dataset.accent;
      await patchConfig({ ui: { ...state.config.ui, accent: swatch.dataset.accent } });
    });
  });

  let fontTimer = null;
  $('#setFont').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('#fontValue').textContent = `${Math.round(value * 100)}%`;
    document.documentElement.style.setProperty('--font-scale', String(value));
    clearTimeout(fontTimer);
    fontTimer = setTimeout(() => patchConfig({ ui: { ...state.config.ui, fontScale: value } }), 350);
  });
}

/* ------------------------------ 数据 ------------------------------ */

function renderData() {
  const info = state.info || {};
  const chatCount = state.chats.filter((c) => c.messages?.length).length;

  $('#setBody').innerHTML = `
    <div class="card">
      <div class="card-title">本地数据目录</div>
      <p class="sr-desc" style="margin:5px 0 0">配置文件 config.json 与对话记录 chats.json 都存放在这里。</p>
      <div class="mono-block"><span>${escapeHtml(info.paths?.dataDir || '')}</span>
        <button class="btn btn-sm" id="btnOpenDir">${icons.folder}<span>打开</span></button>
      </div>
      <div class="kv-list">
        <dt>配置文件</dt><dd>${escapeHtml(info.paths?.config || '')}</dd>
        <dt>对话数量</dt><dd>${chatCount} 段</dd>
        <dt>当前权限</dt><dd>${PERMISSIONS[state.config.ui.permission]?.label || '普通权限'}</dd>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="margin-bottom:10px">清理数据</div>
      <div class="set-row">
        <div>
          <div class="sr-title">清空对话记录</div>
          <div class="sr-desc">删除本机保存的全部对话，配置与供应商保持不变</div>
        </div>
        <div class="sr-control"><button class="btn btn-sm" id="btnClearChats">清空对话</button></div>
      </div>
      <div class="set-row">
        <div>
          <div class="sr-title" style="color:var(--danger)">重置应用</div>
          <div class="sr-desc">删除全部配置（供应商、密钥、偏好），回到初始引导</div>
        </div>
        <div class="sr-control"><button class="btn btn-sm btn-danger" id="btnReset">重置</button></div>
      </div>
    </div>

    <div class="card">
      <div class="about-box">
        <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
          <defs><linearGradient id="aboutGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6B4A"/><stop offset="1" stop-color="#FFB020"/></linearGradient></defs>
          <rect width="32" height="32" rx="9" fill="url(#aboutGrad)"/>
          <path d="M9 10h14a2.6 2.6 0 0 1 2.6 2.6v6a2.6 2.6 0 0 1-2.6 2.6h-6.1l-3.7 3c-.7.6-1.7.1-1.7-.8v-2.2H9a2.6 2.6 0 0 1-2.6-2.6v-6A2.6 2.6 0 0 1 9 10Z" fill="#fff"/>
          <circle cx="12.4" cy="15.6" r="1.25" fill="#FF6B4A"/><circle cx="16.4" cy="15.6" r="1.25" fill="#FFB020"/><circle cx="20.4" cy="15.6" r="1.25" fill="#12B886"/>
        </svg>
        <div>
          <h3>DgxayChatBox</h3>
          <p>一个简洁、明快的多模型 AI 桌面工作台。数据留在本地，权限由你掌握。</p>
        </div>
      </div>
      <div class="kv-list">
        <dt>版本</dt><dd>v${escapeHtml(info.version || '1.0.0')}</dd>
        <dt>运行环境</dt><dd>Electron · ${escapeHtml(info.platform || 'win32')}</dd>
        <dt>接口协议</dt><dd>ChatCompletions · Anthropic Messages · Responses</dd>
        <dt>配置文件</dt><dd>~/.dcb/config.json</dd>
        <dt>许可证</dt><dd>GNU GPL v3.0</dd>
      </div>
    </div>
  `;

  $('#btnOpenDir').addEventListener('click', () => window.dcb.openConfigFolder());
  $('#btnClearChats').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空全部对话？',
      message: '所有对话记录会从本机删除，供应商与设置不受影响。',
      confirmText: '清空'
    });
    if (!ok) return;
    await window.dcb.saveChats([]);
    state.chats = [];
    state.activeChatId = null;
    emit('chat-changed', {});
    renderData();
    toast('对话记录已清空');
  });

  $('#btnReset').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '重置整个应用？',
      message: '将删除供应商、API Key、快捷键与所有偏好设置，并重新进入欢迎引导。对话记录也会一并清空。',
      confirmText: '确认重置'
    });
    if (!ok) return;
    await window.dcb.saveChats([]);
    await window.dcb.resetConfig();
    location.reload();
  });
}
