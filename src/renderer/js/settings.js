import {
  state,
  providers,
  activeProvider,
  activeModel,
  patchConfig,
  currentPermission,
  setActiveModel,
  emit,
  on,
  PERMISSIONS
} from './store.js';
import { $, $$, escapeHtml, toast, openModal, confirmDialog, accelFromEvent, uid } from './ui.js';
import { icons } from './icons.js';
import { refreshAll, refreshChrome } from './chat.js';
import { PROTOCOLS, PROTOCOL_ORDER, protocolMeta, protocolOf, protocolCardsHtml } from './protocols.js';
import { THEME_OPTIONS, applyTheme, themePreference } from './theme.js';
import { applyWidowGuard } from './typography.js';

const TABS = {
  providers: {
    title: '供应商与模型',
    desc: '支持 ChatCompletions、Anthropic Messages 与 Responses 三种协议，添加多个模型后可在输入框右侧随时切换。'
  },
  shortcuts: {
    title: '快捷键',
    desc: '为常用操作绑定顺手的组合键。点击按键框后直接按下新的组合键即可。'
  },
  oauth: {
    title: '账户连接',
    desc: '用 OAuth 连接 OpenAI、Anthropic、xAI 与 Google 账户。令牌只保存在本机，可随时断开。'
  },
  mcp: {
    title: 'MCP Server',
    desc: '管理已安装的 MCP 服务。可以让 AI 在对话中安装，或手动添加后在这里启动与停止。'
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
  window.dcb.onMcpEvent((event) => {
    if (!state.settingsOpen || currentTab !== 'mcp') return;
    if (event.type === 'status') {
      renderMcp();
      return;
    }
    if (event.type === 'log') {
      const log = document.querySelector(`[data-mcp-log="${event.id}"]`);
      if (!log) return;
      if (log.dataset.empty === '1') {
        log.innerHTML = '';
        log.dataset.empty = '0';
      }
      const line = document.createElement('span');
      line.className = event.stream === 'stderr' ? 'err' : '';
      line.textContent = event.text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }
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
  else if (tab === 'oauth') renderOauth();
  else if (tab === 'shortcuts') renderShortcuts();
  else if (tab === 'mcp') renderMcp();
  else if (tab === 'general') renderGeneral();
  else renderData();

  applyWidowGuard($('#setBody'));
}

/* ------------------------------ 供应商 ------------------------------ */

function renderProviders() {
  const list = providers();
  const active = activeProvider();
  const defaultModel = state.config.activeModelId;

  const cards = list
    .map((provider, providerIndex) => {
      const models = provider.models || [];
      const isActive = active && active.id === provider.id;
      const reviewLabel = provider.reviewModelId
        ? (models.find((model) => model.id === provider.reviewModelId)?.name || provider.reviewModelId)
        : providerIndex === 0
          ? '未配置'
          : '默认审查模型';
      return `
      <div class="card" data-provider="${provider.id}">
        <div class="card-head">
          <div style="min-width:0">
            <div class="card-title">
              <span class="provider-dot" style="${isActive ? '' : 'background:#c9c2b6'}"></span>
              ${escapeHtml(provider.name || '未命名供应商')}
              <span class="protocol-badge">${escapeHtml(protocolMeta(provider.protocol).short)}</span>
              ${providerIndex === 0 && list.length > 1 ? '<span class="protocol-badge">默认</span>' : ''}
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
          <span>认证：<b>${
            provider.authMode === 'oauth'
              ? `OAuth · ${escapeHtml(oauthProviderName(provider.oauthProvider))}`
              : 'API Key'
          }</b></span>
          <span>审查模型：<b>${escapeHtml(reviewLabel)}</b></span>
          <span>API Key：<b>${provider.authMode === 'oauth' ? '使用 OAuth 账户' : escapeHtml(maskKey(provider.apiKey))}</b></span>
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

function oauthProviderName(id) {
  const names = { openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI', google: 'Google' };
  return names[id] || id || '未选择';
}

function maskKey(key) {
  if (!key) return '未填写（可留空）';
  const str = String(key);
  if (str.length <= 8) return '••••••••';
  return `${str.slice(0, 3)}••••••${str.slice(-4)}`;
}

function providerRow(id = '', name = '', contextWindow = '') {
  return `<div class="model-row">
    <input class="input mono" data-field="id" value="${escapeHtml(id)}" placeholder="模型 ID，如 gpt-4o" spellcheck="false" />
    <input class="input" data-field="name" value="${escapeHtml(name)}" placeholder="显示名称（可选）" />
    <input class="input mono" data-field="context" type="number" min="0" step="1000" value="${contextWindow || ''}" placeholder="128000" title="上下文窗口，留空则按协议默认" />
    <button class="mr-del" type="button" title="移除">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>`;
}

function refreshReviewSelect(bodyEl, preferred) {
  const select = bodyEl.querySelector('#pvReview');
  if (!select) return;
  const current = preferred ?? select.value;
  const models = $$('#pvModels .model-row')
    .map((row) => ({
      id: row.querySelector('[data-field="id"]').value.trim(),
      name: row.querySelector('[data-field="name"]').value.trim()
    }))
    .filter((model) => model.id);
  const unique = [];
  models.forEach((model) => {
    if (!unique.find((item) => item.id === model.id)) unique.push(model);
  });
  select.innerHTML =
    '<option value="">不配置（使用默认供应商）</option>' +
    unique
      .map(
        (model) =>
          `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name || model.id)} · ${escapeHtml(model.id)}</option>`
      )
      .join('');
  if (unique.some((model) => model.id === current)) select.value = current;
}

async function openProviderEditor(provider) {
  const editing = Boolean(provider);
  const draft = provider
    ? JSON.parse(JSON.stringify(provider))
    : { id: uid('prov'), name: '', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: [] };
  draft.protocol = protocolOf(draft.protocol);
  draft.authMode = draft.authMode === 'oauth' ? 'oauth' : 'apiKey';
  if (!draft.models?.length) draft.models = [{ id: '', name: '' }];
  let selectedProtocol = draft.protocol;

  const oauthProviders = await loadOAuthProviders(true).catch(() => []);
  const connectedOauth = oauthProviders.filter((item) => item.connection && !item.connection.expired);
  if (!draft.oauthProvider) draft.oauthProvider = connectedOauth[0]?.id || '';

  const protocolMetaInfo = PROTOCOLS[draft.protocol];
  const reviewModels = draft.models.filter((model) => model.id);
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
      <label>认证方式</label>
      <select class="input" id="pvAuthMode">
        <option value="apiKey" ${draft.authMode === 'apiKey' ? 'selected' : ''}>API Key</option>
        <option value="oauth" ${draft.authMode === 'oauth' ? 'selected' : ''}>OAuth 账户</option>
      </select>
    </div>
    <div class="field" id="pvKeyWrap" ${draft.authMode === 'oauth' ? 'hidden' : ''}>
      <label>API Key <span class="hint">仅保存在本地</span></label>
      <div style="display:flex;gap:8px">
        <input class="input mono" id="pvKey" type="password" value="${escapeHtml(draft.apiKey)}" placeholder="sk-..." spellcheck="false" style="flex:1" />
        <button class="btn" type="button" id="pvReveal">显示</button>
      </div>
    </div>
    <div class="field" id="pvOauthWrap" ${draft.authMode === 'oauth' ? '' : 'hidden'}>
      <label>OAuth 账户 <span class="hint">在「账户连接」中授权</span></label>
      <select class="input" id="pvOauthAccount">
        ${oauthProviders
          .map(
            (item) =>
              `<option value="${item.id}" ${
                item.connection && !item.connection.expired ? '' : 'disabled'
              } ${draft.oauthProvider === item.id ? 'selected' : ''}>${escapeHtml(item.name)}${
                item.connection ? ` · ${escapeHtml(item.connection.account || '已连接')}` : '（未连接）'
              }</option>`
          )
          .join('')}
      </select>
      <p class="input-hint" id="pvOauthHint">${
        connectedOauth.length
          ? '请求时使用该账户的访问令牌，过期会自动刷新。'
          : '还没有可用账户。请先打开「账户连接」完成授权，或改用 API Key。'
      }</p>
      <button class="btn btn-sm" type="button" id="pvOauthManage">管理账户连接</button>
    </div>
    <div class="field">
      <label>自动审查模型 <span class="hint">未配置时使用默认供应商</span></label>
      <select class="input" id="pvReview">
        <option value="">不配置（使用默认供应商）</option>
        ${reviewModels
          .map(
            (model) =>
              `<option value="${escapeHtml(model.id)}" ${draft.reviewModelId === model.id ? 'selected' : ''}>${escapeHtml(
                model.name || model.id
              )} · ${escapeHtml(model.id)}</option>`
          )
          .join('')}
      </select>
    </div>
    <div class="field">
      <label>模型列表 <span class="hint">可添加多个，对话时随时切换</span></label>
      <div class="model-row-head"><span>模型 ID</span><span>显示名称</span><span>上下文窗口</span><span></span></div>
      <div class="model-rows" id="pvModels">${draft.models
        .map((m) => providerRow(m.id, m.name, m.contextWindow))
        .join('')}</div>
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
    desc: '选择供应商实际使用的接口协议，并配置用于安全审查的模型。',
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
          const protocol = protocolOf(selectedProtocol);
          const reviewModelId = $('#pvReview').value;
          const authMode = $('#pvAuthMode').value === 'oauth' ? 'oauth' : 'apiKey';
          const oauthProvider = authMode === 'oauth' ? $('#pvOauthAccount').value : '';
          const apiKey = authMode === 'apiKey' ? $('#pvKey').value.trim() : draft.apiKey || '';
          const models = $$('#pvModels .model-row')
            .map((row) => ({
              id: row.querySelector('[data-field="id"]').value.trim(),
              name: row.querySelector('[data-field="name"]').value.trim(),
              contextWindow: Number(row.querySelector('[data-field="context"]').value) || 0
            }))
            .filter((m) => m.id)
            .map((m) => ({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow }));

          if (!/^https?:\/\//i.test(baseUrl)) {
            errEl.textContent = '请填写以 http:// 或 https:// 开头的 Base URL';
            return false;
          }
          if (!models.length) {
            errEl.textContent = '请至少添加一个模型 ID';
            return false;
          }
          if (authMode === 'oauth') {
            const account = oauthProviders.find((item) => item.id === oauthProvider);
            if (!account?.connection || account.connection.expired) {
              errEl.textContent = '该账户尚未连接或登录已过期，请先到「账户连接」重新授权';
              return false;
            }
          }
          const unique = [];
          models.forEach((m) => {
            if (!unique.find((u) => u.id === m.id)) unique.push(m);
          });

          const next = providers().map((p) =>
            p.id === draft.id
              ? { ...p, name, protocol, baseUrl, apiKey, authMode, oauthProvider, reviewModelId, models: unique }
              : p
          );
          if (!editing) {
            next.push({
              id: draft.id,
              name,
              protocol,
              baseUrl,
              apiKey,
              authMode,
              oauthProvider,
              reviewModelId,
              models: unique
            });
          }

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
    onMount: (bodyEl, close) => {
      const authModeSelect = bodyEl.querySelector('#pvAuthMode');
      const authSync = () => {
        const oauth = authModeSelect.value === 'oauth';
        bodyEl.querySelector('#pvKeyWrap').hidden = oauth;
        bodyEl.querySelector('#pvOauthWrap').hidden = !oauth;
      };
      authModeSelect.addEventListener('change', authSync);
      authSync();
      bodyEl.querySelector('#pvOauthManage').addEventListener('click', () => {
        close(null);
        openSettings('oauth');
      });

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

      refreshReviewSelect(bodyEl, draft.reviewModelId);

      bodyEl.querySelector('#pvAddModel').addEventListener('click', () => {
        bodyEl.querySelector('#pvModels').insertAdjacentHTML('beforeend', providerRow());
        bodyEl.querySelector('#pvModels').lastElementChild.querySelector('input').focus();
        refreshReviewSelect(bodyEl);
      });

      bodyEl.querySelector('#pvModels').addEventListener('input', (event) => {
        if (event.target.matches('[data-field="id"], [data-field="name"]')) refreshReviewSelect(bodyEl);
      });

      bodyEl.querySelector('#pvModels').addEventListener('click', (event) => {
        const del = event.target.closest('.mr-del');
        if (!del) return;
        const rows = bodyEl.querySelectorAll('#pvModels .model-row');
        if (rows.length <= 1) {
          rows[0].querySelectorAll('input').forEach((input) => (input.value = ''));
          refreshReviewSelect(bodyEl);
          return;
        }
        del.closest('.model-row').remove();
        refreshReviewSelect(bodyEl);
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
        btn.disabled = true;
        hint.textContent = '正在连接…';
        fetched.innerHTML = '';
        try {
          const models = await window.dcb.fetchModels({
            baseUrl,
            apiKey: bodyEl.querySelector('#pvKey').value.trim(),
            protocol: selectedProtocol,
            authMode: bodyEl.querySelector('#pvAuthMode').value,
            oauthProvider: bodyEl.querySelector('#pvOauthAccount').value
          });
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
              refreshReviewSelect(bodyEl);
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

/* ------------------------------ OAuth 账户 ------------------------------ */

let oauthCache = null;

async function loadOAuthProviders(force = false) {
  if (oauthCache && !force) return oauthCache;
  try {
    oauthCache = await window.dcb.oauthList();
  } catch {
    oauthCache = [];
  }
  return oauthCache;
}

function formatExpiry(ts) {
  if (!ts) return '长期有效';
  const d = new Date(ts);
  const pad = (value) => String(value).padStart(2, '0');
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function oauthCard(provider) {
  const connection = provider.connection;
  const connected = Boolean(connection);
  const expired = Boolean(connection?.expired);
  const state = expired ? '已过期' : connected ? '已连接' : '未连接';
  return `<div class="oauth-card ${connected && !expired ? 'connected' : ''}" data-oauth="${provider.id}">
    <div class="oauth-top">
      <span class="oauth-mark">${escapeHtml(provider.name.slice(0, 1))}</span>
      <div>
        <div class="oauth-name">${escapeHtml(provider.name)}</div>
        <div class="oauth-sub">${escapeHtml(provider.subtitle)}</div>
      </div>
      <span class="oauth-state ${connected && !expired ? 'on' : ''}">${state}</span>
    </div>
    ${
      connected
        ? `<div class="oauth-account" title="${escapeHtml(connection.account || '')}">${escapeHtml(
            connection.account || '已连接账户'
          )}</div>
           <div class="oauth-expiry">${
             expired ? '登录已过期，请重新连接' : `有效期至 ${formatExpiry(connection.expiresAt)}`
           }</div>`
        : `<div class="oauth-hint">${escapeHtml(provider.hint)}</div>`
    }
    <div class="oauth-actions">
      <button class="btn ${connected ? '' : 'btn-primary'}" data-oauth-act="connect">
        ${connected ? '重新授权' : '连接'}
      </button>
      ${connected ? '<button class="btn btn-danger" data-oauth-act="disconnect">断开</button>' : ''}
      <span class="hint" style="margin-left:auto;font-size:9.5px">${provider.redirectMode === 'manual' ? '手动授权码' : '系统浏览器'}</span>
    </div>
  </div>`;
}

async function renderOauth() {
  const body = $('#setBody');
  body.innerHTML = `<div class="card"><div class="card-title">正在读取账户连接…</div></div>`;
  const list = await loadOAuthProviders(true);
  if (currentTab !== 'oauth') return;

  body.innerHTML = `
    <div class="oauth-note">
      ${icons.shield}
      <div><b>授权在你的系统浏览器中完成。</b> 令牌保存在本机（优先使用系统加密），不会上传到 DgxayCode 的服务器。连接后可在供应商的「认证方式」中选择对应账户；若平台限制订阅令牌推理，可随时切回 API Key。</div>
    </div>
    <div class="oauth-grid">${list.map(oauthCard).join('')}</div>
    <div class="card">
      <div class="card-title">关于 OAuth 客户端</div>
      <p class="sr-desc" style="margin:6px 0 0">OpenAI、Anthropic 与 xAI 预置了公开桌面客户端，可直接连接。Google 需要在 Google Cloud Console 创建「桌面应用」OAuth 客户端，并把 Client ID 填入连接窗口。端点与权限范围都可以在连接窗口的高级设置里调整。</p>
    </div>
  `;

  $$('#setBody [data-oauth]').forEach((card) => {
    const provider = list.find((item) => item.id === card.dataset.oauth);
    if (!provider) return;
    card.querySelector('[data-oauth-act="connect"]')?.addEventListener('click', () => openOauthConnect(provider));
    card.querySelector('[data-oauth-act="disconnect"]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `断开 ${provider.name} 账户？`,
        message: '本机保存的访问令牌与刷新令牌会被删除。使用该账户的供应商将无法继续请求，直到重新连接或改用 API Key。',
        confirmText: '断开连接'
      });
      if (!ok) return;
      try {
        await window.dcb.oauthDisconnect(provider.id);
        oauthCache = null;
        toast(`${provider.name} 账户已断开`);
        renderOauth();
      } catch (err) {
        toast(err.message || '断开失败', 'error');
      }
    });
  });
}

function openOauthConnect(provider) {
  let flowId = '';
  let phase = 1;
  let busy = false;

  const body = `
    <div class="oauth-status-line" id="oauthStatus"><span class="dot"></span><span id="oauthStatusText">填写客户端信息后开始授权</span></div>
    <div class="field">
      <label>Client ID <span class="hint">${provider.publicClient ? '已预置公开客户端，可替换为自己的' : '必填'}</span></label>
      <input class="input mono" id="oauthClientId" value="${escapeHtml(provider.clientId || '')}" placeholder="OAuth Client ID" spellcheck="false" />
    </div>
    <div class="field">
      <label>Client Secret <span class="hint">可选，公开客户端通常不需要</span></label>
      <input class="input mono" id="oauthSecret" type="password" placeholder="${provider.hasSecret ? '已保存，留空保持不变' : '不填写则使用 PKCE 公共客户端'}" spellcheck="false" />
    </div>
    <div class="field" id="oauthManual" hidden>
      <label>授权码 <span class="hint">从浏览器回调页复制</span></label>
      <input class="input mono" id="oauthCode" placeholder="粘贴授权码，或 code#state" spellcheck="false" />
      <p class="input-hint">Anthropic 会在授权完成后显示一段授权码，复制回这里即可完成连接。</p>
    </div>
    <details class="oauth-endpoints">
      <summary>高级：端点与权限范围</summary>
      <div class="field">
        <label>授权端点</label>
        <input class="input mono" id="oauthAuthorizeUrl" value="${escapeHtml(provider.authorizeUrl || '')}" spellcheck="false" />
      </div>
      <div class="field">
        <label>令牌端点</label>
        <input class="input mono" id="oauthTokenUrl" value="${escapeHtml(provider.tokenUrl || '')}" spellcheck="false" />
      </div>
      <div class="field">
        <label>权限范围</label>
        <input class="input mono" id="oauthScopes" value="${escapeHtml(provider.scopes || '')}" spellcheck="false" />
      </div>
      <div class="field">
        <label>回调地址 <span class="hint">由平台注册决定</span></label>
        <input class="input mono" value="${escapeHtml(provider.redirectUri || '')}" disabled />
      </div>
    </details>
    <div class="form-error" id="oauthErr"></div>
  `;

  const modalPromise = openModal({
    title: `连接 ${provider.name} 账户`,
    desc: provider.hint,
    width: 'wide',
    body,
    actions: [
      {
        label: '取消',
        onClick: async () => {
          if (flowId) await window.dcb.oauthCancel(flowId).catch(() => {});
          return true;
        }
      },
      {
        label: '开始授权',
        variant: 'primary',
        onClick: async (close) => {
          if (busy) return false;
          const errEl = $('#oauthErr');
          const status = $('#oauthStatusText');
          errEl.textContent = '';
          const code = $('#oauthCode')?.value.trim() || '';

          if (phase === 2) {
            if (!code) {
              errEl.textContent = '请粘贴浏览器给出的授权码';
              return false;
            }
            busy = true;
            status.textContent = '正在验证授权码…';
            try {
              await window.dcb.oauthComplete({ id: flowId, code });
              close(true);
              return true;
            } catch (err) {
              errEl.textContent = err.message || '授权失败';
              status.textContent = '授权未完成';
              busy = false;
              return false;
            }
          }

          const clientId = $('#oauthClientId').value.trim();
          if (!clientId) {
            errEl.textContent = '请填写 Client ID';
            return false;
          }

          busy = true;
          try {
            await window.dcb.oauthSaveClient({
              provider: provider.id,
              clientId,
              clientSecret: $('#oauthSecret').value,
              authorizeUrl: $('#oauthAuthorizeUrl').value,
              tokenUrl: $('#oauthTokenUrl').value,
              scopes: $('#oauthScopes').value
            });
            oauthCache = null;
            status.textContent = '正在打开浏览器…';
            const flow = await window.dcb.oauthBegin({ provider: provider.id });
            flowId = flow.id;
            if (flow.mode === 'manual') {
              phase = 2;
              $('#oauthManual').hidden = false;
              status.textContent = '请在浏览器完成授权，然后把授权码粘贴到下方';
              const primary = document.querySelector('.modal-foot .btn-primary');
              if (primary) primary.textContent = '完成连接';
              setTimeout(() => $('#oauthCode')?.focus(), 50);
              busy = false;
              return false;
            }

            status.textContent = '已打开浏览器，等待授权完成…';
            const connection = await window.dcb.oauthWait(flow.id);
            oauthCache = null;
            close(connection || true);
            return true;
          } catch (err) {
            errEl.textContent = err.message || '无法发起授权';
            status.textContent = '授权未开始';
            busy = false;
            return false;
          }
        }
      }
    ],
    onMount: (bodyEl) => {
      bodyEl.querySelector('#oauthClientId')?.focus();
    }
  });

  modalPromise.then((saved) => {
    if (!saved) return;
    oauthCache = null;
    toast(`${provider.name} 账户已连接`);
    if (currentTab === 'oauth') renderOauth();
    else renderTab('oauth');
  });
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
          <div class="sr-desc">即使窗口在后台，也能用组合键呼出 DgxayCode</div>
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

function syncRange(el) {
  if (!el) return;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const value = Number(el.value);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--range-p', `${Math.min(100, Math.max(0, pct))}%`);
}

function renderGeneral() {
  const cfg = state.config;
  const themePref = themePreference();

  $('#setBody').innerHTML = `
    <div class="card">
      <div class="set-row">
        <div>
          <div class="sr-title">外观</div>
          <div class="sr-desc">深色模式不使用纯黑底色，字重也会随之轻一档</div>
        </div>
        <div class="sr-control">
          <div class="segmented" id="setTheme" role="radiogroup" aria-label="外观">
            ${THEME_OPTIONS.map(
              (item) =>
                `<button type="button" data-theme="${item.value}" role="radio" aria-checked="${themePref === item.value}" class="${
                  themePref === item.value ? 'active' : ''
                }">${item.label}</button>`
            ).join('')}
          </div>
        </div>
      </div>
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

  $$('#setTheme button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      $$('#setTheme button').forEach((item) => {
        item.classList.toggle('active', item === btn);
        item.setAttribute('aria-checked', String(item === btn));
      });
      applyTheme(btn.dataset.theme);
      await patchConfig({ ui: { ...state.config.ui, theme: btn.dataset.theme } });
    });
  });

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
    syncRange(event.target);
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

  let fontTimer = null;
  $('#setFont').addEventListener('input', (event) => {
    syncRange(event.target);
    const value = Number(event.target.value);
    $('#fontValue').textContent = `${Math.round(value * 100)}%`;
    document.documentElement.style.setProperty('--font-scale', String(value));
    clearTimeout(fontTimer);
    fontTimer = setTimeout(() => patchConfig({ ui: { ...state.config.ui, fontScale: value } }), 350);
  });

  $$('#setBody input[type="range"]').forEach(syncRange);
}

/* ------------------------------ MCP ------------------------------ */

function mcpStatusLabel(status) {
  return (
    {
      running: '运行中',
      stopped: '已停止',
      stopping: '停止中',
      error: '异常'
    }[status] || status
  );
}

function mcpCard(server) {
  const status = server.status || 'stopped';
  const running = status === 'running';
  const args = (server.args || []).join(' ');
  const logs = (server.logs || [])
    .map((line) => `<span class="${line.stream === 'stderr' ? 'err' : ''}">${escapeHtml(line.text)}</span>`)
    .join('\n');
  return `<div class="mcp-card" data-mcp="${escapeHtml(server.id)}">
    <div class="mcp-top">
      <div style="min-width:0">
        <div class="mcp-name">${escapeHtml(server.name)}<span class="mcp-state ${escapeHtml(status)}">${mcpStatusLabel(
          status
        )}</span>${server.pid ? `<span class="hint" style="font-size:10.5px">pid ${server.pid}</span>` : ''}</div>
        <p class="mcp-cmd">${escapeHtml(server.command)} ${escapeHtml(args)}</p>
        ${server.cwd ? `<p class="mcp-hint">工作目录：<code>${escapeHtml(server.cwd)}</code></p>` : ''}
        ${
          server.error
            ? `<p class="mcp-hint" style="color:var(--danger)">${escapeHtml(server.error)}</p>`
            : ''
        }
      </div>
      <div class="mcp-actions">
        <button class="btn btn-sm" data-mcp-act="${running ? 'stop' : 'start'}">${running ? '停止' : '启动'}</button>
        <button class="btn btn-sm btn-danger" data-mcp-act="delete">删除</button>
      </div>
    </div>
    <div class="mcp-log" data-mcp-log="${escapeHtml(server.id)}" data-empty="${logs ? '0' : '1'}">${
      logs || '<span style="color:var(--text-3)">暂无日志</span>'
    }</div>
  </div>`;
}

async function renderMcp() {
  const body = $('#setBody');
  body.innerHTML = `<div class="card"><div class="card-title">正在读取 MCP 配置…</div></div>`;
  let servers = [];
  try {
    servers = await window.dcb.mcpList();
  } catch (err) {
    body.innerHTML = `<div class="card"><div class="card-title" style="color:var(--danger)">读取 MCP 配置失败</div><p class="mcp-hint">${escapeHtml(
      err.message
    )}</p></div>`;
    return;
  }
  if (currentTab !== 'mcp') return;

  body.innerHTML = `
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
      <div>
        <div class="card-title">已安装 ${servers.length} 个 MCP Server</div>
        <p class="card-sub" style="font-family:inherit">配置保存在 ~/.dcb/mcp.json，退出应用时会自动停止</p>
      </div>
      <button class="btn btn-primary" id="btnAddMcp">${icons.plus}<span>新增 MCP</span></button>
    </div>
    ${
      servers.length
        ? servers.map(mcpCard).join('')
        : `<div class="empty-card">
            <div class="ec-icon">${icons.terminal}</div>
            <h3>还没有 MCP Server</h3>
            <p>可以让 AI 在对话中安装，或手动添加启动命令</p>
            <button class="btn btn-primary" id="btnAddMcpEmpty">新增 MCP</button>
          </div>`
    }
  `;

  $('#btnAddMcp')?.addEventListener('click', () => openMcpEditor());
  $('#btnAddMcpEmpty')?.addEventListener('click', () => openMcpEditor());

  $$('#setBody [data-mcp]').forEach((card) => {
    const server = servers.find((item) => item.id === card.dataset.mcp);
    if (!server) return;
    card.querySelectorAll('[data-mcp-act]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.mcpAct;
        if (action === 'start' || action === 'stop') {
          button.disabled = true;
          try {
            if (action === 'start') {
              await window.dcb.mcpStart(server.id);
              toast(`已启动 ${server.name}`);
            } else {
              await window.dcb.mcpStop(server.id);
              toast(`已停止 ${server.name}`);
            }
          } catch (err) {
            toast(err.message || '操作失败', 'error');
          }
          setTimeout(renderMcp, 250);
          return;
        }
        if (action === 'delete') {
          const ok = await confirmDialog({
            title: '删除这个 MCP Server？',
            message: `将停止并移除「${escapeHtml(server.name)}」的启动配置，此操作不可恢复。`,
            confirmText: '删除'
          });
          if (!ok) return;
          try {
            await window.dcb.mcpRemove(server.id);
            toast('MCP Server 已删除');
            renderMcp();
          } catch (err) {
            toast(err.message || '删除失败', 'error');
          }
        }
      });
    });
  });
}

function openMcpEditor() {
  openModal({
    title: '新增 MCP Server',
    desc: '填写 MCP 服务的启动命令。配置会写入 ~/.dcb/mcp.json，之后可在此启动或停止。',
    width: 'wide',
    body: `
      <div class="field">
        <label>名称</label>
        <input class="input" id="mcpName" placeholder="例如 filesystem" />
      </div>
      <div class="field">
        <label>启动命令</label>
        <input class="input mono" id="mcpCommand" placeholder="npx" spellcheck="false" />
      </div>
      <div class="field">
        <label>参数 <span class="hint">空格分隔</span></label>
        <input class="input mono" id="mcpArgs" placeholder="-y @modelcontextprotocol/server-filesystem D://work" spellcheck="false" />
      </div>
      <div class="field">
        <label>环境变量 <span class="hint">每行 KEY=value</span></label>
        <textarea class="input mono" id="mcpEnv" placeholder="API_KEY=xxx" spellcheck="false"></textarea>
      </div>
      <div class="field">
        <label>工作目录 <span class="hint">可选</span></label>
        <input class="input mono" id="mcpCwd" placeholder="留空使用 ~/.dcb" spellcheck="false" />
      </div>
      <div class="form-error" id="mcpErr"></div>
    `,
    actions: [
      { label: '取消', value: false },
      {
        label: '添加',
        variant: 'primary',
        onClick: async () => {
          const name = $('#mcpName').value.trim();
          const command = $('#mcpCommand').value.trim();
          if (!name || !command) {
            $('#mcpErr').textContent = '名称与启动命令不能为空';
            return false;
          }
          try {
            await window.dcb.mcpAdd({
              name,
              command,
              args: $('#mcpArgs').value.trim(),
              env: $('#mcpEnv').value,
              cwd: $('#mcpCwd').value.trim()
            });
            return true;
          } catch (err) {
            $('#mcpErr').textContent = err.message || '添加失败';
            return false;
          }
        }
      }
    ]
  }).then((saved) => {
    if (!saved) return;
    toast('MCP Server 已添加');
    renderMcp();
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
        <dt>OAuth 配置</dt><dd>${escapeHtml(info.paths?.oauth || '~/.dcb/oauth.json')}</dd>
        <dt>MCP 配置</dt><dd>${escapeHtml(info.paths?.mcp || '~/.dcb/mcp.json')}</dd>
        <dt>技能目录</dt><dd>${escapeHtml(info.paths?.skills || '~/.dcb/skills')}</dd>
        <dt>对话数量</dt><dd>${chatCount} 段</dd>
        <dt>当前权限</dt><dd>${PERMISSIONS[currentPermission()]?.label || '普通权限'}</dd>
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
          <rect width="32" height="32" rx="8" fill="#2563EB"/>
          <path d="M9.4 10.4h13.2a2.4 2.4 0 0 1 2.4 2.4v5.8a2.4 2.4 0 0 1-2.4 2.4h-5.8l-3.6 2.9c-.7.6-1.8.1-1.8-.8v-2.1H9.4a2.4 2.4 0 0 1-2.4-2.4v-5.8a2.4 2.4 0 0 1 2.4-2.4Z" fill="#fff"/>
          <circle cx="12.6" cy="15.7" r="1.15" fill="#2563EB"/><circle cx="16.6" cy="15.7" r="1.15" fill="#2563EB"/><circle cx="20.6" cy="15.7" r="1.15" fill="#2563EB"/>
        </svg>
        <div>
          <h3>DgxayCode</h3>
          <p>一个简洁、明快的多模型 AI 桌面工作台。数据留在本地，权限由你掌握。</p>
        </div>
      </div>
      <div class="kv-list">
        <dt>版本</dt><dd>V1.3（${escapeHtml(info.version || '1.3.0')}）</dd>
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
