import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_PATH = path.join(__dirname, '.env');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

const DEFAULT_DB = {
  inviteCdks: [
    {
      id: crypto.randomUUID(),
      code: 'DEMO-CDK-001',
      label: '默认邀请码',
      enabled: true,
      maxUses: 0,
      used: 0,
      createdAt: new Date().toISOString()
    }
  ],
  records: []
};

const config = await loadConfig();
let db = await loadDatabase();
const sessions = new Map();
let creationQueue = Promise.resolve();

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (error.status) {
      return sendJson(res, error.status, {
        error: error.code || 'request_failed',
        message: error.publicMessage || '请求处理失败。'
      });
    }
    console.error(error);
    sendJson(res, 500, { error: 'server_error', message: '服务暂时不可用，请稍后重试。' });
  }
});

server.listen(config.server.port, config.server.host, () => {
  const mode = config.cpa.dryRun ? 'dry-run' : 'live';
  console.log(`CPA Key Distributor running at http://${config.server.host}:${config.server.port} (${mode})`);
});

async function loadConfig() {
  const fileEnv = await loadDotEnv(ENV_PATH);
  const env = { ...fileEnv, ...process.env };

  return {
    server: {
      host: env.HOST || '127.0.0.1',
      port: Number(env.PORT || 10057)
    },
    adminCdk: env.ADMIN_CDK || '',
    cpa: {
      managementBaseUrl: env.CPA_MANAGEMENT_BASE_URL || 'http://localhost:10059/v0/management',
      managementKey: env.CPA_MANAGEMENT_KEY || '',
      apiKeyPrefix: env.API_KEY_PREFIX || 'sk-cpa-',
      dryRun: parseBoolean(env.DRY_RUN, true)
    },
    security: {
      adminSessionHours: Number(env.ADMIN_SESSION_HOURS || 12)
    }
  };
}

async function loadDotEnv(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return parseDotEnv(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function parseDotEnv(raw) {
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const equalIndex = normalized.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, equalIndex).trim();
    let value = normalized.slice(equalIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(' #');
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trimEnd();
      }
    }

    env[key] = value.replaceAll('\\n', '\n');
  }

  return env;
}

async function loadDatabase() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await readFile(DB_PATH, 'utf8');
    const loaded = JSON.parse(raw);
    return {
      inviteCdks: Array.isArray(loaded.inviteCdks) ? loaded.inviteCdks : [],
      records: Array.isArray(loaded.records) ? loaded.records : []
    };
  } catch {
    await saveDatabase(DEFAULT_DB);
    return structuredClone(DEFAULT_DB);
  }
}

async function saveDatabase(nextDb = db) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_PATH, `${JSON.stringify(nextDb, null, 2)}\n`, 'utf8');
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      mode: config.cpa.dryRun ? 'dry-run' : 'live',
      cpaBaseUrl: config.cpa.managementBaseUrl
    });
  }

  if (url.pathname === '/api/create-key' && req.method === 'POST') {
    return handleCreateKey(req, res);
  }

  if (url.pathname === '/api/admin/login' && req.method === 'POST') {
    return handleAdminLogin(req, res);
  }

  if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
    return handleAdminLogout(req, res);
  }

  if (url.pathname === '/api/admin/me' && req.method === 'GET') {
    return requireAdmin(req, res, () => sendJson(res, 200, { ok: true }));
  }

  if (url.pathname === '/api/admin/summary' && req.method === 'GET') {
    return requireAdmin(req, res, () => {
      const activeCdks = db.inviteCdks.filter((item) => item.enabled).length;
      sendJson(res, 200, {
        activeCdks,
        totalCdks: db.inviteCdks.length,
        totalRecords: db.records.length,
        latestAt: db.records[0]?.createdAt || null,
        mode: config.cpa.dryRun ? 'dry-run' : 'live'
      });
    });
  }

  if (url.pathname === '/api/admin/cdks' && req.method === 'GET') {
    return requireAdmin(req, res, () => sendJson(res, 200, { cdks: db.inviteCdks }));
  }

  if (url.pathname === '/api/admin/cdks' && req.method === 'POST') {
    return requireAdmin(req, res, () => handleCreateCdk(req, res));
  }

  const cdkMatch = url.pathname.match(/^\/api\/admin\/cdks\/([^/]+)$/);
  if (cdkMatch && req.method === 'PATCH') {
    return requireAdmin(req, res, () => handleUpdateCdk(req, res, cdkMatch[1]));
  }

  if (cdkMatch && req.method === 'DELETE') {
    return requireAdmin(req, res, () => handleDeleteCdk(res, cdkMatch[1]));
  }

  if (url.pathname === '/api/admin/records' && req.method === 'GET') {
    return requireAdmin(req, res, () => {
      sendJson(res, 200, { records: db.records.slice(0, 500) });
    });
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, url.pathname);
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function handleCreateKey(req, res) {
  const body = await readJson(req);
  const nickname = sanitizeText(body.nickname, 32);
  const cdkCode = normalizeCdk(body.cdk);

  if (!nickname) {
    return sendJson(res, 400, { error: 'invalid_nickname', message: '请填写使用者昵称。' });
  }

  if (!cdkCode) {
    return sendJson(res, 400, { error: 'invalid_cdk', message: '请填写创建邀请码 CDK。' });
  }

  const task = creationQueue.then(() => issueKey({ nickname, cdkCode, req }));
  creationQueue = task.catch(() => {});
  const result = await task.catch((error) => ({ error }));

  if (result.error) {
    const status = result.error.status || 500;
    return sendJson(res, status, {
      error: result.error.code || 'create_failed',
      message: result.error.publicMessage || '创建失败，请稍后重试。'
    });
  }

  sendJson(res, 201, result);
}

async function issueKey({ nickname, cdkCode, req }) {
  const invite = db.inviteCdks.find((item) => normalizeCdk(item.code) === cdkCode);
  if (!invite || !invite.enabled) {
    throw publicError(403, 'cdk_not_available', '邀请码不可用，请确认后再试。');
  }

  if (invite.maxUses > 0 && invite.used >= invite.maxUses) {
    throw publicError(403, 'cdk_exhausted', '邀请码使用次数已用完。');
  }

  const apiKey = await createCpaApiKey();
  const now = new Date().toISOString();
  invite.used += 1;
  invite.updatedAt = now;

  db.records.unshift({
    id: crypto.randomUUID(),
    createdAt: now,
    ip: getClientIp(req),
    cdk: invite.code,
    cdkLabel: invite.label || '',
    nickname,
    keyPreview: maskKey(apiKey),
    keyHash: hashKey(apiKey)
  });

  await saveDatabase();

  return {
    apiKey,
    createdAt: now,
    nickname,
    keyPreview: maskKey(apiKey),
    mode: config.cpa.dryRun ? 'dry-run' : 'live'
  };
}

async function createCpaApiKey() {
  const apiKey = generateApiKey();

  if (config.cpa.dryRun) {
    return apiKey;
  }

  if (!config.cpa.managementKey) {
    throw publicError(500, 'missing_management_key', '服务端未配置 CPA 管理密钥。');
  }

  const current = await cpaRequest('/api-keys', { method: 'GET' });
  const keys = Array.isArray(current?.['api-keys']) ? current['api-keys'] : [];

  if (!keys.includes(apiKey)) {
    await cpaRequest('/api-keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([...keys, apiKey])
    });
  }

  return apiKey;
}

async function cpaRequest(pathname, options = {}) {
  const base = config.cpa.managementBaseUrl.replace(/\/$/, '');
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.cpa.managementKey}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? parseMaybeJson(text) : {};

  if (!response.ok) {
    console.error('CPA API error', response.status, data);
    throw publicError(response.status, 'cpa_api_error', 'CPA 管理接口返回错误，请检查服务状态和管理密钥。');
  }

  return data;
}

async function handleAdminLogin(req, res) {
  const body = await readJson(req);
  const submitted = String(body.adminCdk || '');

  if (!config.adminCdk || !safeEqual(submitted, config.adminCdk)) {
    return sendJson(res, 401, { error: 'invalid_admin_cdk', message: '管理 CDK 不正确。' });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + config.security.adminSessionHours * 60 * 60 * 1000;
  sessions.set(token, { expiresAt });
  cleanupSessions();

  setCookie(res, 'cpa_admin_session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: Math.floor(config.security.adminSessionHours * 60 * 60),
    path: '/'
  });
  sendJson(res, 200, { ok: true });
}

function handleAdminLogout(req, res) {
  const token = getSessionToken(req);
  if (token) {
    sessions.delete(token);
  }
  setCookie(res, 'cpa_admin_session', '', {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 0,
    path: '/'
  });
  sendJson(res, 200, { ok: true });
}

async function handleCreateCdk(req, res) {
  const body = await readJson(req);
  const code = sanitizeCdkCode(body.code);
  const label = sanitizeText(body.label, 40);
  const maxUses = normalizeMaxUses(body.maxUses);

  if (!code) {
    return sendJson(res, 400, { error: 'invalid_cdk', message: '请输入有效的 CDK。' });
  }

  if (db.inviteCdks.some((item) => normalizeCdk(item.code) === normalizeCdk(code))) {
    return sendJson(res, 409, { error: 'duplicate_cdk', message: '这个 CDK 已存在。' });
  }

  const item = {
    id: crypto.randomUUID(),
    code,
    label,
    enabled: body.enabled !== false,
    maxUses,
    used: 0,
    createdAt: new Date().toISOString()
  };

  db.inviteCdks.unshift(item);
  await saveDatabase();
  sendJson(res, 201, { cdk: item });
}

async function handleUpdateCdk(req, res, id) {
  const body = await readJson(req);
  const item = db.inviteCdks.find((cdk) => cdk.id === id);

  if (!item) {
    return sendJson(res, 404, { error: 'not_found', message: 'CDK 不存在。' });
  }

  if (Object.hasOwn(body, 'code')) {
    const code = sanitizeCdkCode(body.code);
    if (!code) {
      return sendJson(res, 400, { error: 'invalid_cdk', message: '请输入有效的 CDK。' });
    }
    const exists = db.inviteCdks.some((cdk) => cdk.id !== id && normalizeCdk(cdk.code) === normalizeCdk(code));
    if (exists) {
      return sendJson(res, 409, { error: 'duplicate_cdk', message: '这个 CDK 已存在。' });
    }
    item.code = code;
  }

  if (Object.hasOwn(body, 'label')) {
    item.label = sanitizeText(body.label, 40);
  }

  if (Object.hasOwn(body, 'enabled')) {
    item.enabled = Boolean(body.enabled);
  }

  if (Object.hasOwn(body, 'maxUses')) {
    item.maxUses = normalizeMaxUses(body.maxUses);
  }

  item.updatedAt = new Date().toISOString();
  await saveDatabase();
  sendJson(res, 200, { cdk: item });
}

async function handleDeleteCdk(res, id) {
  const before = db.inviteCdks.length;
  db.inviteCdks = db.inviteCdks.filter((item) => item.id !== id);

  if (db.inviteCdks.length === before) {
    return sendJson(res, 404, { error: 'not_found', message: 'CDK 不存在。' });
  }

  await saveDatabase();
  sendJson(res, 200, { ok: true });
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  const session = token ? sessions.get(token) : null;

  if (!session || session.expiresAt <= Date.now()) {
    if (token) {
      sessions.delete(token);
    }
    return sendJson(res, 401, { error: 'unauthorized', message: '请先登录管理端。' });
  }

  return next();
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
  const relative = path.relative(PUBLIC_DIR, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return sendJson(res, 404, { error: 'not_found' });
    }

    const ext = path.extname(resolved);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES.get(ext) || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

    createReadStream(resolved).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'not_found' });
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw publicError(413, 'payload_too_large', '请求内容过大。');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw publicError(400, 'invalid_json', '请求格式不正确。');
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function generateApiKey() {
  return `${config.cpa.apiKeyPrefix}${crypto.randomBytes(30).toString('base64url')}`;
}

function maskKey(key) {
  if (!key || key.length <= 12) {
    return '***';
  }
  return `${key.slice(0, 8)}...${key.slice(-6)}`;
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function publicError(status, code, publicMessage) {
  const error = new Error(publicMessage);
  error.status = status;
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function normalizeCdk(value) {
  return String(value || '').trim().toUpperCase();
}

function sanitizeCdkCode(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w-]/g, '')
    .slice(0, 64)
    .toUpperCase();
}

function sanitizeText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeMaxUses(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.floor(numeric);
}

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.cpa_admin_session || '';
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(';').reduce((cookies, pair) => {
    const [rawName, ...rawValue] = pair.trim().split('=');
    if (!rawName) {
      return cookies;
    }
    cookies[rawName] = decodeURIComponent(rawValue.join('='));
    return cookies;
  }, {});
}

function setCookie(res, name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}
