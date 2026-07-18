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
const SECRET_PLACEHOLDERS = {
  adminCdk: new Set(['change-this-admin-cdk', 'replace-with-your-admin-cdk']),
  managementKey: new Set(['change-this-management-key', 'replace-with-cpa-management-key'])
};
const BRUTE_FORCE_LIMITS = {
  claim: {
    name: 'CDK claim',
    maxFailures: 10,
    windowMs: 10 * 60 * 1000,
    lockoutMs: 15 * 60 * 1000
  },
  admin: {
    name: 'admin login',
    maxFailures: 5,
    windowMs: 10 * 60 * 1000,
    lockoutMs: 30 * 60 * 1000
  }
};
const MAX_BRUTE_FORCE_ENTRIES = 10_000;
const BRUTE_FORCE_CLEANUP_INTERVAL_MS = 60 * 1000;
const RATE_LIMIT_IDENTITY_SECRET = crypto.randomBytes(32);
const bruteForceTrackers = {
  claim: createBruteForceTracker(BRUTE_FORCE_LIMITS.claim),
  admin: createBruteForceTracker(BRUTE_FORCE_LIMITS.admin)
};

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
  inviteCdks: [],
  records: []
};

const config = validateConfig(await loadConfig());
let db = await loadDatabase();
await disableKnownDefaultCdks();
const sessions = new Map();
let creationQueue = Promise.resolve();

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (error.status) {
      return sendPublicError(res, error, 'request_failed', '请求处理失败。');
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
      adminSessionHours: Number(env.ADMIN_SESSION_HOURS || 12),
      trustProxy: parseBoolean(env.TRUST_PROXY, false)
    }
  };
}

function validateConfig(config) {
  const issues = [];
  const adminCdkIssue = getSecretConfigIssue('ADMIN_CDK', config.adminCdk, SECRET_PLACEHOLDERS.adminCdk);

  if (adminCdkIssue) {
    issues.push(adminCdkIssue);
  }

  if (!config.cpa.dryRun) {
    const managementKeyIssue = getSecretConfigIssue(
      'CPA_MANAGEMENT_KEY',
      config.cpa.managementKey,
      SECRET_PLACEHOLDERS.managementKey
    );

    if (managementKeyIssue) {
      issues.push(managementKeyIssue);
    }
  }

  if (issues.length > 0) {
    const details = issues.map((issue) => `- ${issue}`).join('\n');
    throw new Error(
      `Refusing to start because secret configuration is unsafe:\n${details}\nSet unique values in .env or environment variables before restarting.`
    );
  }

  return config;
}

function getSecretConfigIssue(name, value, placeholders) {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return `${name} is required.`;
  }

  if (placeholders.has(normalized)) {
    return `${name} still uses an example value.`;
  }

  return '';
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

async function disableKnownDefaultCdks() {
  let changed = false;
  const now = new Date().toISOString();

  for (const invite of db.inviteCdks) {
    if (invite.enabled && normalizeCdk(invite.code) === 'DEMO-CDK-001') {
      invite.enabled = false;
      invite.updatedAt = now;
      changed = true;
    }
  }

  if (changed) {
    await saveDatabase();
    console.warn('Disabled the insecure default invite CDK. Create a unique CDK from the admin page.');
  }
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
      const requestedPage = normalizePositiveInteger(url.searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER);
      const pageSize = normalizePositiveInteger(url.searchParams.get('pageSize'), 20, 100);
      const totalRecords = db.records.length;
      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const start = (page - 1) * pageSize;

      sendJson(res, 200, {
        records: db.records.slice(start, start + pageSize),
        pagination: {
          page,
          pageSize,
          totalRecords,
          totalPages
        }
      });
    });
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, url.pathname);
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function handleCreateKey(req, res) {
  const rateLimitIdentity = getRateLimitIdentity(req);
  enforceBruteForceLimit(bruteForceTrackers.claim, rateLimitIdentity);

  const body = await readJson(req);
  const nickname = sanitizeText(body.nickname, 32);
  const cdkCode = normalizeCdk(body.cdk);

  if (!nickname) {
    return sendJson(res, 400, { error: 'invalid_nickname', message: '请填写使用者昵称。' });
  }

  if (!cdkCode) {
    return sendJson(res, 400, { error: 'invalid_cdk', message: '请填写创建邀请码 CDK。' });
  }

  const task = creationQueue.then(() => issueKey({ nickname, cdkCode, req, rateLimitIdentity }));
  creationQueue = task.catch(() => {});
  const result = await task.catch((error) => ({ error }));

  if (result.error) {
    return sendPublicError(res, result.error, 'create_failed', '创建失败，请稍后重试。');
  }

  sendJson(res, 201, result);
}

async function issueKey({ nickname, cdkCode, req, rateLimitIdentity }) {
  enforceBruteForceLimit(bruteForceTrackers.claim, rateLimitIdentity);

  const invite = db.inviteCdks.find((item) => normalizeCdk(item.code) === cdkCode);
  const inviteUnavailable =
    !invite || !invite.enabled || (invite.maxUses > 0 && invite.used >= invite.maxUses);

  if (inviteUnavailable) {
    const retryAfterSeconds = recordBruteForceFailure(bruteForceTrackers.claim, rateLimitIdentity);
    if (retryAfterSeconds > 0) {
      throw bruteForceError(retryAfterSeconds);
    }
    throw publicError(403, 'cdk_not_available', '邀请码不可用，请确认后再试。');
  }

  clearBruteForceFailures(bruteForceTrackers.claim, rateLimitIdentity);

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
  const rateLimitIdentity = getRateLimitIdentity(req);
  enforceBruteForceLimit(bruteForceTrackers.admin, rateLimitIdentity);

  const body = await readJson(req);
  const submitted = String(body.adminCdk || '');

  if (!config.adminCdk || !safeEqual(submitted, config.adminCdk)) {
    const retryAfterSeconds = recordBruteForceFailure(bruteForceTrackers.admin, rateLimitIdentity);
    if (retryAfterSeconds > 0) {
      throw bruteForceError(retryAfterSeconds);
    }
    return sendJson(res, 401, { error: 'invalid_admin_cdk', message: '管理 CDK 不正确。' });
  }

  clearBruteForceFailures(bruteForceTrackers.admin, rateLimitIdentity);

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

function sendPublicError(res, error, fallbackCode, fallbackMessage) {
  const retryAfterSeconds = Math.max(0, Math.ceil(Number(error.retryAfterSeconds) || 0));
  const payload = {
    error: error.code || fallbackCode,
    message: error.publicMessage || fallbackMessage
  };

  if (retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    payload.retryAfter = retryAfterSeconds;
  }

  return sendJson(res, error.status || 500, payload);
}

function bruteForceError(retryAfterSeconds) {
  const error = publicError(429, 'too_many_attempts', '尝试次数过多，请稍后再试。');
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function createBruteForceTracker(options) {
  return {
    ...options,
    entries: new Map(),
    lastCleanupAt: 0
  };
}

function getRateLimitIdentity(req) {
  const clientIp = getClientIp(req) || 'unknown';
  return crypto.createHmac('sha256', RATE_LIMIT_IDENTITY_SECRET).update(clientIp).digest('hex');
}

function enforceBruteForceLimit(tracker, identity) {
  const retryAfterSeconds = getBruteForceRetryAfter(tracker, identity);
  if (retryAfterSeconds > 0) {
    throw bruteForceError(retryAfterSeconds);
  }
}

function getBruteForceRetryAfter(tracker, identity, now = Date.now()) {
  cleanupBruteForceTracker(tracker, now);
  const state = tracker.entries.get(identity);

  if (!state || state.lockedUntil <= now) {
    return 0;
  }

  return Math.ceil((state.lockedUntil - now) / 1000);
}

function recordBruteForceFailure(tracker, identity, now = Date.now()) {
  cleanupBruteForceTracker(tracker, now);
  let state = tracker.entries.get(identity);

  if (!state || now - state.windowStartedAt >= tracker.windowMs) {
    state = {
      failures: 0,
      windowStartedAt: now,
      lockedUntil: 0
    };
  }

  state.failures += 1;

  if (state.failures >= tracker.maxFailures) {
    state.lockedUntil = now + tracker.lockoutMs;
    console.warn(
      `Brute-force protection locked ${tracker.name} attempts for client ${identity.slice(0, 12)}.`
    );
  }

  if (!tracker.entries.has(identity) && tracker.entries.size >= MAX_BRUTE_FORCE_ENTRIES) {
    const oldestIdentity = tracker.entries.keys().next().value;
    tracker.entries.delete(oldestIdentity);
  }

  tracker.entries.set(identity, state);
  return state.lockedUntil > now ? Math.ceil((state.lockedUntil - now) / 1000) : 0;
}

function clearBruteForceFailures(tracker, identity) {
  tracker.entries.delete(identity);
}

function cleanupBruteForceTracker(tracker, now) {
  if (now - tracker.lastCleanupAt < BRUTE_FORCE_CLEANUP_INTERVAL_MS) {
    return;
  }

  tracker.lastCleanupAt = now;
  for (const [identity, state] of tracker.entries) {
    const expiresAt = Math.max(state.windowStartedAt + tracker.windowMs, state.lockedUntil);
    if (expiresAt <= now) {
      tracker.entries.delete(identity);
    }
  }
}

function getClientIp(req) {
  if (config.security.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
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

function normalizePositiveInteger(value, fallback, max) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.min(numeric, max);
}

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
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
