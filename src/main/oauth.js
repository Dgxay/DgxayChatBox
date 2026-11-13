'use strict';

/**
 * 账户 OAuth 连接（桌面端 PKCE）。
 *
 * 支持四种账户：
 *  - openai     ChatGPT / Codex 账户（公开客户端 + 固定回环端口 1455）
 *  - anthropic  Claude 账户（官方回跳页 + 手动粘贴授权码）
 *  - xai        SuperGrok / X Premium 账户（回环回调）
 *  - google     Google 账户（回环回调，需要自建 OAuth 客户端）
 *
 * 令牌只写入 ~/.dcb/oauth.json（0600），可用时使用 Electron safeStorage 加密。
 * 账户连接只提供凭据；是否用于推理由供应商的 authMode 决定。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { shell, safeStorage } = require('electron');
const { DCB_DIR, OAUTH_PATH } = require('./config');

const FLOW_TIMEOUT = 5 * 60 * 1000;

const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    subtitle: 'ChatGPT / Codex 账户',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scopes: 'openid profile email offline_access',
    redirectMode: 'loopback',
    redirectUri: 'http://localhost:1455/auth/callback',
    fixedPort: 1455,
    callbackPath: '/auth/callback',
    tokenFormat: 'form',
    extraAuth: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'dgxay_code'
    },
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai',
    hint: '使用 ChatGPT 订阅账户。若推理接口拒绝订阅令牌，请为该供应商改用 API Key。',
    publicClient: true
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    subtitle: 'Claude 账户',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    scopes: 'org:create_api_key user:profile user:inference',
    redirectMode: 'manual',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback',
    tokenFormat: 'json',
    stateEqualsVerifier: true,
    extraAuth: { code: 'true' },
    baseUrl: 'https://api.anthropic.com',
    protocol: 'anthropic',
    hint: '浏览器授权后会显示一段授权码，复制回本窗口即可。官方可能限制订阅令牌用于第三方应用，推理失败时请改用 API Key。',
    publicClient: true
  },
  xai: {
    id: 'xai',
    name: 'xAI',
    subtitle: 'SuperGrok / X Premium+',
    authorizeUrl: 'https://auth.x.ai/oauth2/authorize',
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    scopes: 'openid profile email offline_access grok-cli:access api:access',
    redirectMode: 'loopback',
    redirectUri: '',
    fixedPort: 0,
    callbackPath: '/callback',
    tokenFormat: 'form',
    extraAuth: {},
    baseUrl: 'https://api.x.ai/v1',
    protocol: 'openai',
    hint: '需要 SuperGrok 或 X Premium+。xAI 可能对 OAuth 推理接口做套餐限制，返回 403 时请改用 API Key。',
    publicClient: true
  },
  google: {
    id: 'google',
    name: 'Google',
    subtitle: 'Gemini API 账户',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: '',
    scopes: 'openid email profile https://www.googleapis.com/auth/generative-language.retriever',
    redirectMode: 'loopback',
    redirectUri: '',
    fixedPort: 0,
    callbackPath: '/callback',
    tokenFormat: 'form',
    extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'openai',
    hint: '需要先在 Google Cloud Console 创建「桌面应用」OAuth 客户端，并启用 Generative Language API。',
    publicClient: false
  }
};

const PROVIDER_ORDER = ['openai', 'anthropic', 'xai', 'google'];

/** id -> flow */
const flows = new Map();

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readStore() {
  const empty = { version: 1, clients: {}, connections: {} };
  try {
    if (!fs.existsSync(OAUTH_PATH)) return empty;
    const parsed = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
    return {
      version: 1,
      clients: parsed.clients && typeof parsed.clients === 'object' ? parsed.clients : {},
      connections: parsed.connections && typeof parsed.connections === 'object' ? parsed.connections : {}
    };
  } catch {
    return empty;
  }
}

function writeStore(store) {
  fs.mkdirSync(DCB_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${OAUTH_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, OAUTH_PATH);
}

function decodeConnection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  try {
    let json = '';
    if (raw.enc === true) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      json = safeStorage.decryptString(Buffer.from(String(raw.data || ''), 'base64'));
    } else {
      json = Buffer.from(String(raw.data || ''), 'base64').toString('utf8');
    }
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function encodeConnection(connection) {
  const json = JSON.stringify(connection);
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, data: safeStorage.encryptString(json).toString('base64') };
  }
  return { enc: false, data: Buffer.from(json).toString('base64') };
}

function clientConfig(id, store = readStore()) {
  const def = PROVIDERS[id];
  if (!def) throw new Error('不支持的 OAuth 供应商');
  const saved = store.clients[id] || {};
  const pick = (key) => {
    const value = saved[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    return def[key] || '';
  };
  return {
    id,
    name: def.name,
    authorizeUrl: pick('authorizeUrl'),
    tokenUrl: pick('tokenUrl'),
    clientId: pick('clientId'),
    clientSecret: saved.clientSecret ? String(saved.clientSecret) : '',
    scopes: pick('scopes'),
    redirectUri: def.redirectMode === 'manual' ? pick('redirectUri') : '',
    hint: def.hint,
    baseUrl: def.baseUrl,
    protocol: def.protocol,
    tokenFormat: def.tokenFormat || 'form',
    publicClient: def.publicClient
  };
}

function connectionSummary(id, connection) {
  if (!connection) return null;
  return {
    provider: id,
    account: connection.account || '',
    expiresAt: connection.expiresAt || 0,
    expired: Boolean(connection.expiresAt && Date.now() > connection.expiresAt - 30_000),
    connectedAt: connection.connectedAt || 0,
    canRefresh: Boolean(connection.refreshToken)
  };
}

function listProviders() {
  const store = readStore();
  return PROVIDER_ORDER.map((id) => {
    const def = PROVIDERS[id];
    const config = clientConfig(id, store);
    return {
      id,
      name: def.name,
      subtitle: def.subtitle,
      hint: def.hint,
      redirectMode: def.redirectMode,
      redirectUri: config.redirectUri || (def.redirectMode === 'loopback' ? '由系统分配回环端口' : def.redirectUri),
      scopes: config.scopes,
      authorizeUrl: config.authorizeUrl,
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      hasSecret: Boolean(config.clientSecret),
      publicClient: def.publicClient,
      baseUrl: def.baseUrl,
      protocol: def.protocol,
      connection: connectionSummary(id, decodeConnection(store.connections[id]))
    };
  });
}

function saveClient(id, patch = {}) {
  const def = PROVIDERS[id];
  if (!def) throw new Error('不支持的 OAuth 供应商');
  const store = readStore();
  const current = store.clients[id] || {};
  const next = { ...current };

  for (const key of ['authorizeUrl', 'tokenUrl', 'clientId', 'scopes', 'redirectUri']) {
    if (typeof patch[key] === 'string') {
      const value = patch[key].trim();
      if (value) next[key] = value;
      else delete next[key];
    }
  }
  if (typeof patch.clientSecret === 'string') {
    if (patch.clientSecret.trim()) next.clientSecret = patch.clientSecret.trim();
    else if (patch.clearSecret) delete next.clientSecret;
  }

  if (next.authorizeUrl && !/^https?:\/\//i.test(next.authorizeUrl)) {
    throw new Error('授权端点必须以 http:// 或 https:// 开头');
  }
  if (next.tokenUrl && !/^https?:\/\//i.test(next.tokenUrl)) {
    throw new Error('令牌端点必须以 http:// 或 https:// 开头');
  }

  store.clients[id] = next;
  writeStore(store);
  return listProviders().find((item) => item.id === id);
}

function disconnect(id) {
  const store = readStore();
  delete store.connections[id];
  writeStore(store);
  return true;
}

function decodeJwt(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return {};
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function accountFromTokens(tokens) {
  const claims = decodeJwt(tokens.id_token || '');
  const accessClaims = decodeJwt(tokens.access_token || '');
  const email = claims.email || accessClaims.email || '';
  const name = claims.name || claims.preferred_username || accessClaims.name || '';
  const subject = claims.sub || accessClaims.sub || '';
  return email || name || (subject ? `账户 ${String(subject).slice(0, 10)}` : '已连接账户');
}

async function fetchAccount(id, tokens) {
  const def = PROVIDERS[id];
  if (!def.userInfoUrl || !tokens.access_token) return '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(def.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const data = await res.json();
    return data.email || data.name || data.sub || '';
  } catch {
    return '';
  }
}

async function requestToken(config, params) {
  const body =
    config.tokenFormat === 'json'
      ? JSON.stringify(params)
      : new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': config.tokenFormat === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'DgxayCode/1.4.1'
      },
      body,
      signal: controller.signal
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    if (!res.ok || !data.access_token) {
      const detail = data.error_description || data.error?.message || data.error || text.slice(0, 300);
      throw new Error(`OAuth 令牌交换失败：HTTP ${res.status}${detail ? ` · ${detail}` : ''}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function persistConnection(id, tokens) {
  const store = readStore();
  const existing = decodeConnection(store.connections[id]) || {};
  const expiresIn = Number(tokens.expires_in);
  const connection = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || existing.refreshToken || '',
    tokenType: tokens.token_type || 'Bearer',
    scope: tokens.scope || '',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    account: tokens.account || existing.account || accountFromTokens(tokens),
    connectedAt: existing.connectedAt || Date.now(),
    updatedAt: Date.now()
  };
  store.connections[id] = encodeConnection(connection);
  writeStore(store);
  return connection;
}

async function refreshConnection(id, connection) {
  const store = readStore();
  const config = clientConfig(id, store);
  const params = {
    grant_type: 'refresh_token',
    refresh_token: connection.refreshToken,
    client_id: config.clientId
  };
  if (config.clientSecret) params.client_secret = config.clientSecret;
  const tokens = await requestToken(config, params);
  return persistConnection(id, {
    ...tokens,
    refresh_token: tokens.refresh_token || connection.refreshToken,
    account: connection.account
  });
}

async function getAccessToken(id) {
  const store = readStore();
  const connection = decodeConnection(store.connections[id]);
  if (!connection?.accessToken) {
    throw new Error(`尚未连接 ${PROVIDERS[id]?.name || id} 账户，请先到 设置 → 账户连接 完成授权`);
  }
  if (connection.expiresAt && Date.now() > connection.expiresAt - 60_000) {
    if (!connection.refreshToken) {
      throw new Error(`${PROVIDERS[id].name} 的登录已过期，请重新连接账户`);
    }
    const refreshed = await refreshConnection(id, connection);
    return refreshed.accessToken;
  }
  return connection.accessToken;
}

function startLoopback(flow) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      let url;
      try {
        url = new URL(req.url, 'http://127.0.0.1');
      } catch {
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      if (url.pathname !== flow.callbackPath) {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || '';
      const ok = !error && Boolean(code) && state === flow.state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>DgxayCode</title>` +
          `<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f7f7f5;color:#1f2023">` +
          `<div style="text-align:center"><div style="width:44px;height:44px;border-radius:12px;background:#2563eb;display:inline-grid;place-items:center;color:#fff;font-size:22px">✓</div>` +
          `<h1 style="font-size:18px;margin:16px 0 6px">${ok ? '授权完成' : '授权未完成'}</h1>` +
          `<p style="font-size:13px;color:#6b6d72;margin:0">${ok ? '可以关闭此页面，返回 DgxayCode。' : '请回到应用重试。'}</p></div></body>`
      );

      if (!ok) {
        const err = new Error(
          error ? `授权被拒绝：${error}` : state !== flow.state ? '授权回调 state 不匹配' : '授权回调缺少 code'
        );
        failFlow(flow, err);
        return;
      }
      try {
        await finalizeFlow(flow, code, state);
      } catch (err) {
        failFlow(flow, err);
      }
    });

    server.once('error', reject);
    const port = flow.fixedPort || 0;
    const host = flow.fixedPort ? 'localhost' : '127.0.0.1';
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = address.port;
      flow.server = server;
      flow.redirectUri = flow.redirectUriTemplate.replace('{port}', String(actualPort));
      resolve();
    });
  });
}

async function begin(input = {}) {
  const id = String(input.provider || '');
  const def = PROVIDERS[id];
  if (!def) throw new Error('不支持的 OAuth 供应商');

  const store = readStore();
  const config = clientConfig(id, store);
  if (!config.clientId) {
    throw new Error('请先填写该平台的 OAuth Client ID');
  }

  for (const [label, url] of [
    ['授权端点', config.authorizeUrl],
    ['令牌端点', config.tokenUrl]
  ]) {
    if (!/^https?:\/\//i.test(url || '')) {
      throw new Error(`${label}必须是 http:// 或 https:// 地址`);
    }
  }

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = def.stateEqualsVerifier ? verifier : base64url(crypto.randomBytes(16));
  const flowId = `oauth_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

  const flow = {
    id: flowId,
    provider: id,
    verifier,
    state,
    config,
    callbackPath: def.callbackPath,
    fixedPort: def.fixedPort || 0,
    redirectUriTemplate:
      def.redirectMode === 'manual'
        ? config.redirectUri
        : def.fixedPort
          ? config.redirectUri
          : `http://127.0.0.1:{port}${def.callbackPath}`,
    redirectUri: '',
    server: null,
    settled: false,
    timer: null,
    resolve: null,
    reject: null
  };

  flow.promise = new Promise((resolve, reject) => {
    flow.resolve = resolve;
    flow.reject = reject;
  });
  // 手动授权流程不会调用 wait()，避免超时后出现未处理的 rejection
  flow.promise.catch(() => {});

  if (def.redirectMode === 'loopback') {
    await startLoopback(flow);
  } else {
    flow.redirectUri = config.redirectUri;
  }

  const authUrl = new URL(config.authorizeUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', flow.redirectUri);
  authUrl.searchParams.set('scope', config.scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(def.extraAuth || {})) {
    authUrl.searchParams.set(key, value);
  }

  flows.set(flowId, flow);
  flow.timer = setTimeout(() => {
    failFlow(flow, new Error('授权等待超时，请重新发起连接'));
  }, FLOW_TIMEOUT);

  try {
    // 自动化测试时可以关闭系统浏览器，直接访问回环回调
    if (process.env.DCB_OAUTH_NO_BROWSER !== '1') {
      await shell.openExternal(authUrl.toString());
    }
  } catch (err) {
    failFlow(flow, new Error(`无法打开浏览器：${err.message}`));
    throw err;
  }

  return {
    id: flowId,
    provider: id,
    mode: def.redirectMode,
    authUrl: authUrl.toString(),
    redirectUri: flow.redirectUri,
    expiresAt: Date.now() + FLOW_TIMEOUT
  };
}

async function finalizeFlow(flow, rawCode, state) {
  if (!flow || flow.settled) return null;
  if (state && flow.state && state !== flow.state) {
    throw new Error('授权回调 state 不匹配，已中止');
  }
  const code = String(rawCode || '').trim();
  if (!code) throw new Error('授权码为空');

  const params = {
    grant_type: 'authorization_code',
    code,
    client_id: flow.config.clientId,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.verifier
  };
  if (flow.config.clientSecret) params.client_secret = flow.config.clientSecret;
  if (PROVIDERS[flow.provider].stateEqualsVerifier) params.state = state || flow.state;

  const tokens = await requestToken(flow.config, params);
  const account = (await fetchAccount(flow.provider, tokens)) || accountFromTokens(tokens);
  const connection = persistConnection(flow.provider, { ...tokens, account });

  flow.settled = true;
  clearTimeout(flow.timer);
  if (flow.server) {
    try {
      flow.server.close();
    } catch {
      /* ignore */
    }
  }
  const summary = connectionSummary(flow.provider, connection);
  flow.resolve(summary);
  setTimeout(() => flows.delete(flow.id), 30_000).unref?.();
  return summary;
}

function failFlow(flow, error) {
  if (!flow || flow.settled) return;
  flow.settled = true;
  clearTimeout(flow.timer);
  if (flow.server) {
    try {
      flow.server.close();
    } catch {
      /* ignore */
    }
  }
  flow.reject(error);
  setTimeout(() => flows.delete(flow.id), 30_000).unref?.();
}

function wait(id) {
  const flow = flows.get(String(id));
  if (!flow) throw new Error('授权会话不存在或已结束，请重新发起连接');
  return flow.promise;
}

async function complete(id, rawInput) {
  const flow = flows.get(String(id));
  if (!flow) throw new Error('授权会话不存在或已结束，请重新发起连接');
  let code = String(rawInput || '').trim();
  let state = '';
  if (code.includes('#')) {
    const parts = code.split('#');
    code = parts[0].trim();
    state = parts.slice(1).join('#').trim();
  } else if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      code = url.searchParams.get('code') || '';
      state = url.searchParams.get('state') || '';
    } catch {
      /* keep raw */
    }
  }
  if (!code) throw new Error('没有识别到授权码，请重新复制');
  return finalizeFlow(flow, code, state);
}

function cancel(id) {
  const flow = flows.get(String(id));
  if (!flow) return false;
  failFlow(flow, new Error('已取消授权'));
  return true;
}

module.exports = {
  PROVIDERS,
  PROVIDER_ORDER,
  listProviders,
  saveClient,
  disconnect,
  begin,
  wait,
  complete,
  cancel,
  getAccessToken
};
