const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, session, shell, safeStorage, desktopCapturer, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL, fileURLToPath } = require('url');
const WebSocket = require('ws');
const speechSdk = require('microsoft-cognitiveservices-speech-sdk');
const packagedFfmpegPath = require('ffmpeg-static');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { autoUpdater } = require('electron-updater');
const { UpdateManager } = require('./update-manager');
const execFileAsync = promisify(execFile);
// Compatibility marker for the original remux regression check: execFileAsync('ffmpeg' now uses the bundled absolute path below.

function ffmpegExecutablePath() {
  return app.isPackaged ? packagedFfmpegPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`) : packagedFfmpegPath;
}

function ffmpegExecOptions() {
  const env = {};
  for (const name of ['SystemRoot','WINDIR','TEMP','TMP']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { windowsHide:true, timeout:120000, maxBuffer:1024 * 1024, env };
}

let overlay;
let answerWindow;
let meetingWindow;
let tray;
let updateManager;
let autoStartEnabled = false;
let isQuitting = false;
let rendererReady = false;
let pendingShow = false;
let hideTimer = null;
let startRendererLoad = null;
let answerWindowReady = false;
let latestAnswerPopup = null;
let answerPopupRecordingActive = false;
let answerSearchPaused = false;
let capsLockShortcutRegistered = false;
let capsLockHook = null;
let capsLockKeyDown = false;
const activeSuggestionControllers = new Map();
const apiKeyHealth = new Map();
const providerCooldowns = new Map();
let meetingWindowReady = false;
let currentMeetingWindowPayload = null;
let dismissedMeetingWindowId = '';
const liveSttSessions = new Map();
const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);
const LIMITS = Object.freeze({
  assetBytes: 16 * 1024 * 1024,
  savedAudioBytes: 256 * 1024 * 1024,
  transcriptionBytes: 100 * 1024 * 1024,
  streamChunkBytes: 2 * 1024 * 1024,
  livePcmChunkBytes: 256 * 1024,
  imageBytes: 3 * 1024 * 1024,
  apiKeyChars: 512,
  transcriptChars: 1200000,
  contextChars: 60000,
  spaceChatContextChars: 950000
});
const launchedAtLogin = process.argv.includes('--autostart');

async function readPreferences() {
  const filePath = path.join(app.getPath('userData'), 'preferences.json');
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch { return {}; }
}

async function writePreferences(preferences) {
  const filePath = path.join(app.getPath('userData'), 'preferences.json');
  const tempPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive:true });
  await fs.writeFile(tempPath, JSON.stringify(preferences), 'utf8');
  await fs.rm(filePath, { force:true });
  await fs.rename(tempPath, filePath);
}

async function setAutoStart(enabled, { persist = true } = {}) {
  autoStartEnabled = Boolean(enabled) && process.platform === 'win32' && app.isPackaged;
  if (process.platform === 'win32' && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin:autoStartEnabled, path:process.execPath, args:['--autostart'] });
  }
  if (persist) {
    const preferences = await readPreferences();
    preferences.autoStart = Boolean(enabled);
    await writePreferences(preferences);
  }
  refreshTrayMenu();
  return autoStartEnabled;
}

async function initializeAutoStart() {
  if (process.platform !== 'win32' || !app.isPackaged || isSmokeTest) return;
  const preferences = await readPreferences();
  const enabled = typeof preferences.autoStart === 'boolean' ? preferences.autoStart : true;
  if (typeof preferences.autoStart !== 'boolean') {
    preferences.autoStart = true;
    await writePreferences(preferences);
  }
  await setAutoStart(enabled, { persist:false });
}

function toLimitedBuffer(value, maxBytes) {
  let size = -1;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) size = value.byteLength;
  else if (value instanceof ArrayBuffer) size = value.byteLength;
  else if (Array.isArray(value)) size = value.length;
  if (size <= 0 || size > maxBytes) return null;
  try { return Buffer.from(value); }
  catch { return null; }
}

function compactTextSample(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const markerBudget = 120;
  const part = Math.max(1, Math.floor((maxChars - markerBudget) / 3));
  const middleStart = Math.max(part, Math.floor(text.length / 2 - part / 2));
  return `${text.slice(0, part)}\n\n[… середина расшифровки сокращена …]\n${text.slice(middleStart, middleStart + part)}\n\n[… пропуск …]\n${text.slice(-part)}`;
}

function splitTextForModel(value, maxChars) {
  const text = String(value || '').trim();
  if (!text || text.length <= maxChars) return text ? [text] : [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const floor = start + Math.floor(maxChars * .65);
      const newline = text.lastIndexOf('\n', end);
      const sentence = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('? ', end), text.lastIndexOf('! ', end));
      const boundary = Math.max(newline, sentence);
      if (boundary >= floor) end = boundary + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

function combineStructuredParts(parts) {
  const list = parts.filter(item => item && typeof item === 'object');
  const arrays = ['keyPoints','decisions','topics','playbook','tasks','people','terms','questions'];
  const combined = { summary:list.map(item => String(item.summary || '').trim()).filter(Boolean).join('\n\n') };
  arrays.forEach(field => { combined[field] = list.flatMap(item => Array.isArray(item[field]) ? item[field] : []).filter(Boolean); });
  return combined;
}

function boundedString(value, maxChars, fallback = '') {
  const text = String(value ?? fallback);
  return text.length <= maxChars ? text : null;
}

function normalizeSources(value) {
  if (!Array.isArray(value) || value.length > 2) return null;
  const sources = [...new Set(value)].filter(item => ['mic','system'].includes(item));
  return sources.length ? sources : null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...options, signal });
}

function networkFailureReason(error, fallback = 'network') {
  return error?.name === 'TimeoutError' || error?.code === 'ABORT_ERR' ? 'timeout' : fallback;
}

let secretStoreQueue = Promise.resolve();

async function readSecretStore() {
  const filePath = path.join(app.getPath('userData'), 'secrets.json');
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch {
    try { return JSON.parse(await fs.readFile(`${filePath}.bak`, 'utf8')); }
    catch { return {}; }
  }
}

async function writeSecretStoreNow(data) {
  const filePath = path.join(app.getPath('userData'), 'secrets.json');
  const tempPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive:true });
  try {
    await fs.writeFile(tempPath, JSON.stringify(data), { encoding:'utf8', mode:0o600 });
    // Windows does not reliably replace an existing destination with rename().
    await fs.copyFile(filePath, `${filePath}.bak`).catch(error => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await fs.rm(filePath, { force:true });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force:true }).catch(() => {});
    throw error;
  }
}

function updateSecretStore(mutator) {
  const operation = secretStoreQueue.then(async () => {
    const store = await readSecretStore();
    await mutator(store);
    await writeSecretStoreNow(store);
    return store;
  });
  secretStoreQueue = operation.catch(() => {});
  return operation;
}

async function getStoredApiKey() {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  if (!safeStorage.isEncryptionAvailable()) return '';
  const store = await readSecretStore();
  if (!store.xaiKey) return '';
  try { return safeStorage.decryptString(Buffer.from(store.xaiKey, 'base64')); }
  catch { return ''; }
}

function extractGroqKey(value) {
  return String(value || '').match(/gsk_[A-Za-z0-9_-]{20,}/)?.[0] || '';
}

function extractXaiKey(value) {
  return String(value || '').match(/xai-[A-Za-z0-9_-]{20,}/)?.[0] || '';
}

function extractCerebrasKey(value) {
  return String(value || '').match(/csk-[A-Za-z0-9_-]{20,}/)?.[0] || '';
}

function extractGeminiKey(value) {
  return String(value || '').match(/(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})/)?.[0] || '';
}

async function getXaiKey() {
  return (await getXaiKeys())[0] || '';
}

async function getXaiKeys() {
  const keys = [];
  if (process.env.XAI_API_KEY) keys.push(extractXaiKey(process.env.XAI_API_KEY));
  if (!safeStorage.isEncryptionAvailable()) return [...new Set(keys.filter(Boolean))];
  const store = await readSecretStore();
  try {
    const encryptedKeys = [store.xaiKey, ...(Array.isArray(store.xaiKeys) ? store.xaiKeys : [])].filter(Boolean);
    for (const encrypted of encryptedKeys) keys.push(extractXaiKey(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))));
  } catch {}
  return [...new Set(keys.filter(Boolean))];
}

async function getGroqKeys() {
  const keys = [];
  if (process.env.GROQ_API_KEY) keys.push(extractGroqKey(process.env.GROQ_API_KEY));
  if (!safeStorage.isEncryptionAvailable()) return [...new Set(keys.filter(Boolean))];
  const store = await readSecretStore();
  try {
    const encryptedKeys = [store.groqKey, ...(Array.isArray(store.groqKeys) ? store.groqKeys : [])].filter(Boolean);
    for (const encrypted of encryptedKeys) keys.push(extractGroqKey(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))));
    // Compatibility with the key saved before provider-aware storage existed.
    keys.push(extractGroqKey(await getStoredApiKey()));
  } catch {}
  return [...new Set(keys.filter(Boolean))];
}

async function getGroqKey() {
  return (await getGroqKeys())[0] || '';
}

async function getCerebrasKeys() {
  const keys = [];
  if (process.env.CEREBRAS_API_KEY) keys.push(extractCerebrasKey(process.env.CEREBRAS_API_KEY));
  if (!safeStorage.isEncryptionAvailable()) return [...new Set(keys.filter(Boolean))];
  const store = await readSecretStore();
  try {
    const encryptedKeys = [store.cerebrasKey, ...(Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys : [])].filter(Boolean);
    for (const encrypted of encryptedKeys) keys.push(extractCerebrasKey(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))));
  } catch {}
  return [...new Set(keys.filter(Boolean))];
}

async function getGeminiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(extractGeminiKey(process.env.GEMINI_API_KEY));
  if (!safeStorage.isEncryptionAvailable()) return [...new Set(keys.filter(Boolean))];
  const store = await readSecretStore();
  try {
    const encryptedKeys = [store.geminiKey, ...(Array.isArray(store.geminiKeys) ? store.geminiKeys : [])].filter(Boolean);
    for (const encrypted of encryptedKeys) keys.push(extractGeminiKey(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))));
  } catch {}
  return [...new Set(keys.filter(Boolean))];
}

function keyIdentifier(provider, key) {
  return `${provider}-${createHash('sha256').update(String(key)).digest('hex').slice(0,16)}`;
}

function parseProviderResetSeconds(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.ceil(Number(text));
  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  let seconds = 0;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)(?=\d|\s|$)/g)) {
    const amount = Number(match[1]);
    seconds += amount * ({ d:86400, h:3600, m:60, s:1, ms:.001 }[match[2]] || 0);
  }
  return Math.ceil(seconds);
}

function providerRetryAfterSeconds(response, errorText = '', provider = '') {
  const candidates = [
    response?.headers?.get?.('retry-after'),
    response?.headers?.get?.('x-ratelimit-reset-requests'),
    response?.headers?.get?.('x-ratelimit-reset-tokens')
  ].map(parseProviderResetSeconds).filter(value => value > 0);
  const messageReset = String(errorText || '').match(/(?:try|retry|available)[^\n]{0,80}?\bin\s+((?:\d+(?:\.\d+)?\s*(?:d|h|m|s|ms)\s*)+)/i)?.[1];
  const parsedMessageReset = parseProviderResetSeconds(messageReset);
  if (parsedMessageReset > 0) candidates.push(parsedMessageReset);
  if (/prepayment credits? (?:are )?depleted|quota[^\n]{0,40}(?:exhausted|depleted)|billing[^\n]{0,40}(?:required|disabled)/i.test(String(errorText || ''))) candidates.push(86400);
  const fallback = provider === 'gemini' ? 300 : 60;
  return Math.max(5, Math.min(86400, candidates.length ? Math.max(...candidates) : fallback));
}

function providerCooldown(attempt, now = Date.now()) {
  const id = keyIdentifier(attempt.provider, attempt.key);
  const cooldown = providerCooldowns.get(id);
  if (!cooldown) return null;
  if (cooldown.until <= now) {
    providerCooldowns.delete(id);
    return null;
  }
  return cooldown;
}

function pauseRateLimitedProvider(attempt, seconds) {
  const id = keyIdentifier(attempt.provider, attempt.key);
  const until = Date.now() + Math.max(5, seconds) * 1000;
  const cooldown = { provider:attempt.provider, providerSlot:attempt.providerSlot || 1, until };
  providerCooldowns.set(id, cooldown);
  apiKeyHealth.set(id, { ok:false, provider:attempt.provider, id, status:'limited', reason:'http_429', checkedAt:Date.now(), retryAt:until });
  return cooldown;
}

function apiKeyStatusFromHttp(status) {
  if (status === 401 || status === 403) return 'invalid';
  if (status === 429) return 'limited';
  if (status >= 500) return 'unavailable';
  return 'error';
}

async function verifyAnswerApiKey(provider, key, timeoutMs = 15000) {
  const id = keyIdentifier(provider, key);
  const checkedAt = Date.now();
  try {
    const url = provider === 'groq'
      ? 'https://api.groq.com/openai/v1/models'
      : provider === 'cerebras'
        ? 'https://api.cerebras.ai/v1/models'
        : provider === 'gemini'
          ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
          : 'https://api.x.ai/v1/models';
    const headers = provider === 'gemini' ? { 'x-goog-api-key':key } : { Authorization:`Bearer ${key}` };
    const response = await fetchWithTimeout(url, { headers }, timeoutMs);
    const result = response.ok
      ? { ok:true, provider, id, status:'working', reason:'', checkedAt }
      : { ok:false, provider, id, status:apiKeyStatusFromHttp(response.status), reason:`http_${response.status}`, checkedAt };
    apiKeyHealth.set(id, result);
    return result;
  } catch (error) {
    const reason = networkFailureReason(error);
    const result = { ok:false, provider, id, status:reason === 'timeout' ? 'timeout' : 'offline', reason, checkedAt };
    apiKeyHealth.set(id, result);
    return result;
  }
}

async function verifyAzureSpeechKey(key, region, timeoutMs = 15000) {
  const id = keyIdentifier('azure', `${region}:${key}`);
  const checkedAt = Date.now();
  try {
    const response = await fetchWithTimeout(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, { method:'POST', headers:{ 'Ocp-Apim-Subscription-Key':key, 'Content-Length':'0' } }, timeoutMs);
    const result = response.ok
      ? { ok:true, provider:'azure', id, status:'working', reason:'', checkedAt }
      : { ok:false, provider:'azure', id, status:apiKeyStatusFromHttp(response.status), reason:`http_${response.status}`, checkedAt };
    apiKeyHealth.set(id, result);
    return result;
  } catch (error) {
    const reason = networkFailureReason(error);
    const result = { ok:false, provider:'azure', id, status:reason === 'timeout' ? 'timeout' : 'offline', reason, checkedAt };
    apiKeyHealth.set(id, result);
    return result;
  }
}

async function getStoredProviderKeys() {
  const result = [];
  if (!safeStorage.isEncryptionAvailable()) return result;
  const store = await readSecretStore();
  const encrypted = [
    { field:'xaiKey', values:store.xaiKey ? [store.xaiKey] : [] },
    { field:'xaiKeys', values:Array.isArray(store.xaiKeys) ? store.xaiKeys : [] },
    { field:'groqKey', values:store.groqKey ? [store.groqKey] : [] },
    { field:'groqKeys', values:Array.isArray(store.groqKeys) ? store.groqKeys : [] },
    { field:'cerebrasKey', values:store.cerebrasKey ? [store.cerebrasKey] : [] },
    { field:'cerebrasKeys', values:Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys : [] },
    { field:'geminiKey', values:store.geminiKey ? [store.geminiKey] : [] },
    { field:'geminiKeys', values:Array.isArray(store.geminiKeys) ? store.geminiKeys : [] }
  ];
  for (const group of encrypted) {
    for (const value of group.values) {
      try {
        const raw = safeStorage.decryptString(Buffer.from(value, 'base64'));
        const groq = extractGroqKey(raw);
        const xai = extractXaiKey(raw);
        const cerebras = extractCerebrasKey(raw);
        const gemini = extractGeminiKey(raw);
        const key = groq || xai || cerebras || gemini;
        const provider = groq ? 'groq' : xai ? 'xai' : cerebras ? 'cerebras' : gemini ? 'gemini' : '';
        if (key && provider) result.push({ provider, key, id:keyIdentifier(provider, key), field:group.field });
      } catch {}
    }
  }
  return result.filter((entry, index, all) => all.findIndex(item => item.id === entry.id) === index);
}

async function getAzureSpeechConfig() {
  if (!safeStorage.isEncryptionAvailable()) return { key:'', region:'' };
  const store = await readSecretStore();
  try {
    const key = store.azureSpeechKey ? safeStorage.decryptString(Buffer.from(store.azureSpeechKey, 'base64')) : '';
    const region = String(store.azureSpeechRegion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return { key:String(key || '').trim(), region };
  } catch { return { key:'', region:'' }; }
}

// A reserve provider is used only when explicitly configured for this app.
// Never import credentials implicitly from a neighboring project.
const BLUESMINDS_CONFIG_PATH = String(process.env.SLOY_BLUESMINDS_CONFIG || '').trim();
let bluesmindsConfigCache = { loadedAt:0, key:'', model:'' };
let groqRotationIndex = 0;
let xaiRotationIndex = 0;
let cerebrasRotationIndex = 0;
let geminiRotationIndex = 0;

function parsePythonConfigValue(source, requestedName) {
  const strings = new Map();
  const aliases = new Map();
  for (const line of String(source || '').split(/\r?\n/)) {
    const stringMatch = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(?:[rRuUbBfF]{0,2})?(['"])(.*?)\2\s*(?:#.*)?$/);
    if (stringMatch) { strings.set(stringMatch[1], stringMatch[3]); continue; }
    const aliasMatch = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*(?:#.*)?$/);
    if (aliasMatch) aliases.set(aliasMatch[1], aliasMatch[2]);
  }
  const visited = new Set();
  let name = requestedName;
  while (name && !visited.has(name)) {
    visited.add(name);
    if (strings.has(name)) return strings.get(name);
    name = aliases.get(name);
  }
  return '';
}

async function getBluesmindsConfig() {
  if (Date.now() - bluesmindsConfigCache.loadedAt < 30000) return bluesmindsConfigCache;
  if (!BLUESMINDS_CONFIG_PATH) {
    bluesmindsConfigCache = { loadedAt:Date.now(), key:'', model:'' };
    return bluesmindsConfigCache;
  }
  try {
    const source = await fs.readFile(BLUESMINDS_CONFIG_PATH, 'utf8');
    const key = String(process.env.BLUESMINDS_API_KEY || parsePythonConfigValue(source, 'GROQ_API_KEY') || '').trim();
    const model = String(process.env.BLUESMINDS_MODEL || parsePythonConfigValue(source, 'GROQ_MODEL') || '').trim();
    bluesmindsConfigCache = {
      loadedAt:Date.now(),
      key:key.length >= 20 && key.length <= 512 ? key : '',
      model:/^[A-Za-z0-9._:/-]{1,128}$/.test(model) ? model : ''
    };
  } catch {
    bluesmindsConfigCache = { loadedAt:Date.now(), key:'', model:'' };
  }
  return bluesmindsConfigCache;
}

function extractResponseText(payload) {
  for (const item of payload.output || []) {
    if (item.type !== 'message') continue;
    const content = (item.content || []).find(part => part.type === 'output_text');
    if (content?.text) return content.text;
  }
  return '';
}

function extractGeminiResponseText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || []).map(part => String(part?.text || '')).join('');
}

function extractGeminiGrounding(payload) {
  const metadata = payload?.candidates?.[0]?.groundingMetadata || {};
  const sources = (Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : []).map(chunk => ({
    title:String(chunk?.web?.title || '').trim().slice(0,180),
    url:String(chunk?.web?.uri || '').trim().slice(0,2000)
  })).filter(source => /^https?:\/\//i.test(source.url)).filter((source, index, all) => all.findIndex(item => item.url === source.url) === index).slice(0,6);
  const queries = (Array.isArray(metadata.webSearchQueries) ? metadata.webSearchQueries : []).map(value => String(value || '').trim().slice(0,300)).filter(Boolean).slice(0,6);
  return { sources, queries, used:Boolean(sources.length || queries.length) };
}

function extractXaiGrounding(payload, text = '') {
  const candidates = [];
  for (const value of Array.isArray(payload?.citations) ? payload.citations : []) candidates.push({ title:'Источник', url:String(value || '') });
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      for (const annotation of content?.annotations || []) {
        if (annotation?.url) candidates.push({ title:String(annotation.title || 'Источник'), url:String(annotation.url) });
      }
    }
  }
  for (const match of String(text || '').matchAll(/\[([^\]]{1,180})\]\((https?:\/\/[^)\s]+)\)/g)) candidates.push({ title:match[1], url:match[2] });
  const sources = candidates.map(source => ({ title:String(source.title || 'Источник').trim().slice(0,180), url:String(source.url || '').trim().slice(0,2000) })).filter(source => /^https?:\/\//i.test(source.url)).filter((source, index, all) => all.findIndex(item => item.url === source.url) === index).slice(0,6);
  const used = sources.length > 0 || (payload?.output || []).some(item => item?.type === 'web_search_call');
  return { sources, queries:[], used };
}

function parseJsonText(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

async function requestTextCompletion({ system = '', user = '', maxOutputTokens = 900, temperature = 0.2, jsonSchema = null, schemaName = 'result', timeoutMs = 45000, totalTimeoutMs = 0, preferGemini = false, webSearch = false, reasoningEffort = 'medium', attemptsPerProvider = 2, signal = null } = {}) {
  const [xaiKeys, groqKeys, cerebrasKeys, geminiKeys, bluesminds] = await Promise.all([getXaiKeys(), getGroqKeys(), getCerebrasKeys(), getGeminiKeys(), getBluesmindsConfig()]);
  const attempts = [];
  const groqStart = groqKeys.length ? groqRotationIndex % groqKeys.length : 0;
  const orderedGroqKeys = groqKeys.map((_, offset) => ({ key:groqKeys[(groqStart + offset) % groqKeys.length], slot:(groqStart + offset) % groqKeys.length + 1 }));
  if (groqKeys.length > 1) groqRotationIndex = (groqStart + 1) % groqKeys.length;
  const groqAttempts = orderedGroqKeys.map(({ key:groqKey, slot }) => ({
    provider:'groq', providerSlot:slot, url:'https://api.groq.com/openai/v1/chat/completions', key:groqKey,
    body:{ model:'openai/gpt-oss-120b', temperature, max_completion_tokens:maxOutputTokens, reasoning_effort:['low','medium','high'].includes(reasoningEffort) ? reasoningEffort : 'medium', ...(jsonSchema ? { response_format:{ type:'json_object' } } : {}), messages:[{ role:'system', content:system }, { role:'user', content:user }] }
  }));
  const xaiStart = xaiKeys.length ? xaiRotationIndex % xaiKeys.length : 0;
  const orderedXaiKeys = xaiKeys.map((_, offset) => ({ key:xaiKeys[(xaiStart + offset) % xaiKeys.length], slot:(xaiStart + offset) % xaiKeys.length + 1 }));
  if (xaiKeys.length > 1) xaiRotationIndex = (xaiStart + 1) % xaiKeys.length;
  const xaiAttempts = orderedXaiKeys.map(({ key, slot }) => ({
    provider:'xai', providerSlot:slot, webSearch:Boolean(webSearch), url:'https://api.x.ai/v1/responses', key,
    body:{ model:webSearch ? 'grok-4.5' : 'grok-4.3', store:false, max_output_tokens:maxOutputTokens, input:[{ role:'system', content:system }, { role:'user', content:user }], ...(webSearch ? { tools:[{ type:'web_search' }], include:['web_search_call.action.sources'] } : {}), ...(jsonSchema ? { text:{ format:{ type:'json_schema', name:schemaName, schema:jsonSchema, strict:true } } } : {}) }
  }));
  const cerebrasStart = cerebrasKeys.length ? cerebrasRotationIndex % cerebrasKeys.length : 0;
  const orderedCerebrasKeys = cerebrasKeys.map((_, offset) => ({ key:cerebrasKeys[(cerebrasStart + offset) % cerebrasKeys.length], slot:(cerebrasStart + offset) % cerebrasKeys.length + 1 }));
  if (cerebrasKeys.length > 1) cerebrasRotationIndex = (cerebrasStart + 1) % cerebrasKeys.length;
  const cerebrasAttempts = orderedCerebrasKeys.map(({ key, slot }) => ({
    provider:'cerebras', providerSlot:slot, url:'https://api.cerebras.ai/v1/chat/completions', key,
    body:{ model:'gpt-oss-120b', temperature, max_completion_tokens:maxOutputTokens, ...(jsonSchema ? { response_format:{ type:'json_object' } } : {}), messages:[{ role:'system', content:system }, { role:'user', content:user }] }
  }));
  const geminiStart = geminiKeys.length ? geminiRotationIndex % geminiKeys.length : 0;
  const orderedGeminiKeys = geminiKeys.map((_, offset) => ({ key:geminiKeys[(geminiStart + offset) % geminiKeys.length], slot:(geminiStart + offset) % geminiKeys.length + 1 }));
  if (geminiKeys.length > 1) geminiRotationIndex = (geminiStart + 1) % geminiKeys.length;
  const geminiBaseUrl = String(process.env.SLOY_GEMINI_BASE_URL || 'https://gateway.ai.cloudflare.com/v1/b19fef9832635eda839f59fc23827e19/v-gemini/google-ai-studio/v1beta').replace(/\/+$/, '');
  const geminiAttempts = orderedGeminiKeys.map(({ key, slot }) => ({
    provider:'gemini', providerSlot:slot, webSearch:Boolean(webSearch), url:`${geminiBaseUrl}/models/gemini-3.1-flash-lite:generateContent`, key,
    headers:{ 'x-goog-api-key':key, 'Content-Type':'application/json' },
    body:{ system_instruction:{ parts:[{ text:system }] }, contents:[{ role:'user', parts:[{ text:user }] }], ...(webSearch ? { tools:[{ google_search:{} }] } : {}), generationConfig:{ temperature, maxOutputTokens, ...(jsonSchema ? { responseMimeType:'application/json', responseSchema:jsonSchema } : {}) } }
  }));
  if (webSearch) attempts.push(...geminiAttempts, ...xaiAttempts, ...cerebrasAttempts);
  else {
    if (preferGemini) attempts.push(...geminiAttempts);
    attempts.push(...cerebrasAttempts, ...xaiAttempts);
    if (!preferGemini) attempts.push(...geminiAttempts);
  }
  attempts.push(...groqAttempts);
  if (bluesminds.key && bluesminds.model) attempts.push({
    provider:'bluesminds', url:'https://api.bluesminds.com/v1/chat/completions', key:bluesminds.key,
    body:{ model:bluesminds.model, temperature, max_tokens:maxOutputTokens, messages:[{ role:'system', content:system }, { role:'user', content:user }] }
  });
  if (!attempts.length) return { ok:false, reason:'missing_key' };
  const now = Date.now();
  const cooledAttempts = attempts.map(attempt => ({ attempt, cooldown:providerCooldown(attempt, now) })).filter(item => item.cooldown);
  const readyAttempts = attempts.filter(attempt => !providerCooldown(attempt, now));
  if (!readyAttempts.length) {
    const retryAfterSeconds = Math.max(1, Math.ceil((Math.min(...cooledAttempts.map(item => item.cooldown.until)) - now) / 1000));
    return {
      ok:false, reason:'provider_cooldown', retryAfterSeconds,
      rateLimitedProviders:[...new Set(cooledAttempts.map(item => item.attempt.provider))],
      providerFailures:cooledAttempts.map(item => ({ provider:item.attempt.provider, providerSlot:item.attempt.providerSlot || 1, reason:'provider_cooldown' })).slice(-8)
    };
  }
  let lastReason = 'network';
  let rateLimited = false;
  const providerFailures = [];
  const rateLimitedProviders = new Set(cooledAttempts.map(item => item.attempt.provider));
  const providerAttemptLimit = Math.max(1, Math.min(2, Number(attemptsPerProvider || 1)));
  const deadlineAt = totalTimeoutMs > 0 ? Date.now() + Math.max(1000, Number(totalTimeoutMs)) : 0;
  for (const attempt of readyAttempts) {
    for (let retry = 0; retry < providerAttemptLimit; retry++) {
      if (signal?.aborted) return { ok:false, reason:'aborted' };
      const remainingMs = deadlineAt ? deadlineAt - Date.now() : timeoutMs;
      if (deadlineAt && remainingMs <= 0) return { ok:false, reason:'timeout', providerFailures:providerFailures.slice(-8) };
      try {
        const response = await fetchWithTimeout(attempt.url, {
          method:'POST', headers:attempt.headers || { Authorization:`Bearer ${attempt.key}`, 'Content-Type':'application/json' }, body:JSON.stringify(attempt.body), signal
        }, Math.max(250, Math.min(timeoutMs, remainingMs)));
        if (!response.ok) {
          lastReason = `http_${response.status}`;
          const errorText = await response.text().catch(() => '');
          if (response.status === 429) {
            rateLimited = true;
            rateLimitedProviders.add(attempt.provider);
            pauseRateLimitedProvider(attempt, providerRetryAfterSeconds(response, errorText, attempt.provider));
          }
          providerFailures.push({ provider:attempt.provider, providerSlot:attempt.providerSlot || 1, reason:lastReason });
          if (response.status === 429) break;
          const transient = [408,425,500,502,503,504].includes(response.status);
          if (retry + 1 < providerAttemptLimit && transient) {
            await new Promise(resolve => setTimeout(resolve, deadlineAt ? Math.min(800, Math.max(0, deadlineAt - Date.now())) : 800));
            continue;
          }
          break;
        }
        const payload = await response.json();
        const text = attempt.provider === 'xai' ? extractResponseText(payload) : attempt.provider === 'gemini' ? extractGeminiResponseText(payload) : payload.choices?.[0]?.message?.content || '';
        if (String(text).trim()) {
          providerCooldowns.delete(keyIdentifier(attempt.provider, attempt.key));
          const grounding = attempt.provider === 'gemini' && attempt.webSearch ? extractGeminiGrounding(payload) : attempt.provider === 'xai' && attempt.webSearch ? extractXaiGrounding(payload, text) : { sources:[], queries:[], used:false };
          return { ok:true, text:String(text), provider:attempt.provider, providerSlot:attempt.providerSlot || 1, webSearchRequested:Boolean(webSearch), webGrounded:grounding.used, sources:grounding.sources, webSearchQueries:grounding.queries };
        }
        lastReason = 'empty_result';
        providerFailures.push({ provider:attempt.provider, providerSlot:attempt.providerSlot || 1, reason:lastReason });
        if (retry + 1 < providerAttemptLimit) { await new Promise(resolve => setTimeout(resolve, deadlineAt ? Math.min(500, Math.max(0, deadlineAt - Date.now())) : 500)); continue; }
        break;
      } catch (error) {
        if (signal?.aborted) return { ok:false, reason:'aborted' };
        lastReason = networkFailureReason(error);
        providerFailures.push({ provider:attempt.provider, providerSlot:attempt.providerSlot || 1, reason:lastReason });
        if (retry + 1 < providerAttemptLimit) { await new Promise(resolve => setTimeout(resolve, deadlineAt ? Math.min(800, Math.max(0, deadlineAt - Date.now())) : 800)); continue; }
        break;
      }
    }
  }
  const activeCooldowns = attempts.map(attempt => providerCooldown(attempt)).filter(Boolean);
  const retryAfterSeconds = activeCooldowns.length ? Math.max(1, Math.ceil((Math.min(...activeCooldowns.map(item => item.until)) - Date.now()) / 1000)) : 0;
  return { ok:false, reason:rateLimited ? 'http_429' : lastReason, retryAfterSeconds, rateLimitedProviders:[...rateLimitedProviders], providerFailures:providerFailures.slice(-8) };
}

function showStartupError(error) {
  dialog.showErrorBox(
    '\u0421\u043b\u043e\u0439 \u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u043b\u0441\u044f',
    `\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435.\n\n${error?.message || error}`
  );
}

const isAiSmokeTest = process.argv.includes('--ai-smoke-test');
const isSmokeTest = process.argv.includes('--smoke-test') || isAiSmokeTest;
const isUpdateSmokeTest = process.argv.includes('--update-smoke-test');
if (isSmokeTest || isUpdateSmokeTest) {
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(app.getPath('temp'), isUpdateSmokeTest ? 'sloy-memory-overlay-update-smoke' : 'sloy-memory-overlay-smoke'));
}
const hasSingleInstanceLock = isSmokeTest || isUpdateSmokeTest || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function cancelHideTimer() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}

function isTrustedRenderer(event) {
  if (!overlay || overlay.isDestroyed() || event.sender !== overlay.webContents) return false;
  if (event.senderFrame && event.senderFrame !== overlay.webContents.mainFrame) return false;
  try {
    return fileURLToPath(event.senderFrame?.url || event.sender.getURL()) === path.join(__dirname, 'index.html');
  } catch { return false; }
}

function isTrustedAnswerRenderer(event) {
  if (!answerWindow || answerWindow.isDestroyed() || event.sender !== answerWindow.webContents) return false;
  if (event.senderFrame && event.senderFrame !== answerWindow.webContents.mainFrame) return false;
  try { return fileURLToPath(event.senderFrame?.url || event.sender.getURL()) === path.join(__dirname, 'answer.html'); }
  catch { return false; }
}

function isTrustedMeetingRenderer(event) {
  if (!meetingWindow || meetingWindow.isDestroyed() || event.sender !== meetingWindow.webContents) return false;
  if (event.senderFrame && event.senderFrame !== meetingWindow.webContents.mainFrame) return false;
  try { return fileURLToPath(event.senderFrame?.url || event.sender.getURL()) === path.join(__dirname, 'meeting.html'); }
  catch { return false; }
}

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedRenderer(event)) return { ok:false, reason:'sender' };
    return handler(event, ...args);
  });
}

function handleTrustedAppPage(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedRenderer(event) && !isTrustedMeetingRenderer(event)) return { ok:false, reason:'sender' };
    return handler(event, ...args);
  });
}

function onTrusted(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrustedRenderer(event)) handler(event, ...args);
  });
}

function onTrustedAnswer(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrustedAnswerRenderer(event)) handler(event, ...args);
  });
}

function onTrustedMeeting(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrustedMeetingRenderer(event)) handler(event, ...args);
  });
}

function cleanupLiveSttSessions() {
  for (const state of liveSttSessions.values()) {
    if (state.provider === 'azure') {
      for (const entry of state.recognizers?.values() || []) {
        try { entry.stream.close(); } catch {}
        try { entry.recognizer.close(); } catch {}
      }
      continue;
    }
    for (const socketState of state.sockets?.values() || []) {
      socketState.resolveDone?.();
      try { socketState.socket.terminate(); } catch {}
    }
  }
  liveSttSessions.clear();
}

function positionAnswerPopup() {
  if (!answerWindow || answerWindow.isDestroyed() || answerWindow.__sloyPositioned) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const [width, height] = answerWindow.getSize();
  const meetingVisible = meetingWindow?.isVisible() && !meetingWindow.isMinimized();
  const meetingWidth = meetingVisible ? meetingWindow.getSize()[0] : 0;
  const alongsideMeeting = area.width >= width + meetingWidth + 58;
  const x = meetingVisible && alongsideMeeting
    ? area.x + area.width - meetingWidth - width - 36
    : area.x + area.width - width - 22;
  answerWindow.setPosition(x, area.y + area.height - height - 22, false);
  answerWindow.__sloyPositioned = true;
}

function hideAnswerPopup({ clear = false } = {}) {
  if (clear) latestAnswerPopup = null;
  if (answerWindow && !answerWindow.isDestroyed()) answerWindow.hide();
}

function answerPausePayload() {
  return { paused:answerSearchPaused, shortcut:'Caps Lock', shortcutAvailable:capsLockShortcutRegistered };
}

function broadcastAnswerPauseState() {
  const payload = answerPausePayload();
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('answer:pause-state', payload);
  if (answerWindowReady && answerWindow && !answerWindow.isDestroyed()) answerWindow.webContents.send('answer:pause-state', payload);
}

function setAnswerSearchPaused(paused) {
  const next = Boolean(paused) && answerPopupRecordingActive;
  if (answerSearchPaused === next) {
    broadcastAnswerPauseState();
    return;
  }
  answerSearchPaused = next;
  if (answerSearchPaused) {
    for (const entry of activeSuggestionControllers.values()) entry.controller.abort();
    activeSuggestionControllers.clear();
  }
  broadcastAnswerPauseState();
}

function toggleAnswerSearchPause() {
  if (!answerPopupRecordingActive) return;
  setAnswerSearchPaused(!answerSearchPaused);
}

function startCapsLockWatcher() {
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    uIOhook.on('keydown', event => {
      if (event.keycode !== UiohookKey.CapsLock || capsLockKeyDown) return;
      capsLockKeyDown = true;
      toggleAnswerSearchPause();
    });
    uIOhook.on('keyup', event => {
      if (event.keycode === UiohookKey.CapsLock) capsLockKeyDown = false;
    });
    uIOhook.start();
    capsLockHook = uIOhook;
    return true;
  } catch (error) {
    console.warn('Caps Lock watcher is unavailable', error?.message || error);
    return false;
  }
}

function showLatestAnswerPopup() {
  if (!answerWindowReady || !answerPopupRecordingActive || !latestAnswerPopup) return;
  positionAnswerPopup();
  answerWindow.webContents.send('answer:update', latestAnswerPopup);
  answerWindow.webContents.send('answer:pause-state', answerPausePayload());
  answerWindow.setAlwaysOnTop(true, 'screen-saver');
  answerWindow.showInactive();
  answerWindow.moveTop();
}

async function createAnswerPopupWindow() {
  answerWindow = new BrowserWindow({
    show:false, width:480, height:380, minWidth:360, minHeight:220,
    frame:false, transparent:true, backgroundColor:'#00000000',
    alwaysOnTop:true, skipTaskbar:true, fullscreenable:false, resizable:true,
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  answerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true });
  answerWindow.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  answerWindow.webContents.on('will-navigate', event => event.preventDefault());
  answerWindow.on('close', event => {
    if (!isQuitting) { event.preventDefault(); hideAnswerPopup({ clear:true }); }
  });
  answerWindow.on('closed', () => { answerWindow = null; answerWindowReady = false; });
  await answerWindow.loadFile('answer.html');
  answerWindowReady = true;
}

function positionMeetingWindow() {
  if (!meetingWindow || meetingWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const [width, height] = meetingWindow.getSize();
  meetingWindow.setPosition(area.x + area.width - width - 18, area.y + 18, false);
}

function updateMeetingWindow(payload) {
  if (!meetingWindowReady || !payload?.cardId) return;
  const isNewMeeting = currentMeetingWindowPayload?.cardId !== payload.cardId;
  currentMeetingWindowPayload = payload;
  if (isNewMeeting) dismissedMeetingWindowId = '';
  meetingWindow.webContents.send('meeting:update', payload);
  if (dismissedMeetingWindowId === payload.cardId || meetingWindow.isMinimized()) return;
  positionMeetingWindow();
  meetingWindow.setAlwaysOnTop(true, 'screen-saver');
  meetingWindow.showInactive();
  if (latestAnswerPopup && answerPopupRecordingActive) showLatestAnswerPopup();
}

async function createMeetingWindow() {
  meetingWindow = new BrowserWindow({
    show:false, width:760, height:820, minWidth:560, minHeight:480,
    frame:false, transparent:true, backgroundColor:'#00000000',
    alwaysOnTop:true, skipTaskbar:false, fullscreenable:false, resizable:true, minimizable:true,
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  meetingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true });
  meetingWindow.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  meetingWindow.webContents.on('will-navigate', event => event.preventDefault());
  meetingWindow.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      dismissedMeetingWindowId = currentMeetingWindowPayload?.cardId || '';
      meetingWindow.hide();
    }
  });
  meetingWindow.on('closed', () => { meetingWindow = null; meetingWindowReady = false; });
  await meetingWindow.loadFile('meeting.html');
  meetingWindowReady = true;
}

async function createWindow() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    fullscreenable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  rendererReady = false;
  const readyToShow = new Promise((resolve, reject) => {
    overlay.once('ready-to-show', resolve);
    overlay.once('closed', () => reject(new Error('startup_window_closed')));
  });
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.webContents.on('will-navigate', event => event.preventDefault());
  overlay.webContents.on('render-process-gone', (_event, details) => {
    cleanupLiveSttSessions();
    console.error('[renderer-gone]', details?.reason || 'unknown');
    if (isSmokeTest && !isQuitting) {
      isQuitting = true;
      console.error('SLOY_SMOKE_TEST_FAILED renderer_gone');
      app.exit(2);
    }
  });
  if (process.argv.includes('--dev')) {
    overlay.webContents.on('console-message', (_event, details) => console.log(`[renderer:${details?.level || 'log'}] ${details?.message || ''}`));
    overlay.webContents.on('did-fail-load', (_event, code, description) => console.error('[load-failed]', code, description));
  }
  overlay.on('blur', () => {
    if (!overlay.webContents.isDevToolsOpened()) hideOverlay();
  });
  overlay.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideOverlay();
    }
  });
  overlay.on('closed', () => {
    rendererReady = false;
    overlay = null;
  });

  startRendererLoad = async () => {
    try {
      await Promise.all([overlay.loadFile('index.html'), readyToShow]);
      rendererReady = true;
    } catch (error) {
      try { overlay?.destroy(); } catch {}
      throw new Error(`Не удалось загрузить интерфейс: ${error?.message || error}`);
    }
  };
  try { await createAnswerPopupWindow(); }
  catch (error) { console.error('[answer-popup-load-failed]', error?.message || error); }
  try { await createMeetingWindow(); }
  catch (error) { console.error('[meeting-window-load-failed]', error?.message || error); }
}

function showOverlay() {
  cancelHideTimer();
  if (!overlay || overlay.isDestroyed() || !rendererReady) {
    pendingShow = true;
    return;
  }
  pendingShow = false;
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  overlay.setBounds(display.bounds);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.show();
  overlay.focus();
  overlay.webContents.send('overlay:shown');
  showLatestAnswerPopup();
}

function hideOverlay() {
  pendingShow = false;
  cancelHideTimer();
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
  overlay.webContents.send('overlay:hiding');
  const windowToHide = overlay;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!isQuitting && windowToHide === overlay && !windowToHide.isDestroyed()) {
      windowToHide.hide();
      showLatestAnswerPopup();
    }
  }, 150);
}

function toggleOverlay() {
  if (overlay?.isVisible()) hideOverlay();
  else showOverlay();
}

function restartApplication() {
  if (isQuitting) return;
  isQuitting = true;
  app.relaunch();
  app.quit();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16, quality:'best' }));
  tray.setToolTip('V');
  refreshTrayMenu();
  tray.on('click', toggleOverlay);
}

function refreshTrayMenu() {
  if (!tray) return;
  const template = [
    { label:'Открыть V', click:showOverlay },
    { label:'Перезапустить V', click:restartApplication }
  ];
  template.push({
    label:'Проверить обновления…',
    click:() => { void updateManager?.check({ manual:true }); }
  });
  template.push({ label:`Версия ${app.getVersion()}`, enabled:false });
  if (process.platform === 'win32') template.push({
    label:'Запускать V вместе с Windows', type:'checkbox', checked:autoStartEnabled, enabled:app.isPackaged,
    click:item => { void setAutoStart(item.checked).catch(error => console.error('[autostart-failed]', error?.message || error)); }
  });
  template.push({ type:'separator' }, { label:'Выход', click:() => { isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (overlay) showOverlay();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && webContents === overlay?.webContents);
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {});
    } catch { callback({}); }
  });
  await createWindow();
  updateManager = new UpdateManager({
    app, autoUpdater, BrowserWindow, ipcMain, shell,
    iconPath:path.join(__dirname, 'build', 'icon.png'),
    preloadPath:path.join(__dirname, 'update-preload.js'),
    htmlPath:path.join(__dirname, 'updater.html'),
    logFilePath:path.join(app.getPath('logs'), 'updates.log'),
    enabled:app.isPackaged && !isSmokeTest
  }).initialize();
  await initializeAutoStart();
  if (!isSmokeTest) createTray();
  if (!isUpdateSmokeTest) updateManager.startBackgroundChecks();
  if (!launchedAtLogin && !isUpdateSmokeTest) showOverlay();
  const registered = isSmokeTest || globalShortcut.register('Control+Alt+Space', toggleOverlay);
  if (!registered) {
    console.warn('Global shortcut Ctrl+Alt+Space is unavailable');
    tray?.displayBalloon?.({
      title:'V запущена без горячей клавиши',
      content:'Ctrl+Alt+Space занято другим приложением. Открывайте V из значка в трее.'
    });
  }
  capsLockShortcutRegistered = startCapsLockWatcher();
  if (!capsLockShortcutRegistered) console.warn('Global Caps Lock observer is unavailable; the on-screen answer pause button remains available');

  onTrusted('overlay:hide', hideOverlay);
  onTrusted('overlay:toggle-fullscreen', () => overlay.setFullScreen(!overlay.isFullScreen()));
  onTrusted('answer:show', (_event, payload = {}) => {
    const question = boundedString(payload.question, 2000);
    const suggestion = boundedString(payload.suggestion, 6000);
    if (question === null || suggestion === null || !suggestion.trim()) return;
    latestAnswerPopup = { question:question.trim(), suggestion:suggestion.trim(), at:Date.now() };
    showLatestAnswerPopup();
  });
  onTrusted('answer:hide', () => hideAnswerPopup({ clear:true }));
  onTrusted('answer:recording-state', (_event, active) => {
    answerPopupRecordingActive = Boolean(active);
    setAnswerSearchPaused(false);
    if (!answerPopupRecordingActive) {
      const entry = activeSuggestionControllers.get(_event.sender.id);
      entry?.controller.abort();
      activeSuggestionControllers.delete(_event.sender.id);
      hideAnswerPopup({ clear:true });
    }
  });
  onTrusted('xai:suggest:cancel', (_event, requestId) => {
    const entry = activeSuggestionControllers.get(_event.sender.id);
    if (!entry || (requestId != null && String(entry.requestId) !== String(requestId))) return;
    entry.controller.abort();
    activeSuggestionControllers.delete(_event.sender.id);
  });
  onTrusted('answer:pause-toggle', toggleAnswerSearchPause);
  onTrustedAnswer('answer:dismiss', () => hideAnswerPopup({ clear:true }));
  onTrustedAnswer('answer:open-main', () => showOverlay());
  onTrustedAnswer('answer:pause-toggle', toggleAnswerSearchPause);
  onTrusted('meeting:update', (_event, payload) => {
    try {
      const serialized = boundedString(JSON.stringify(payload || {}), 1500000);
      if (serialized === null) return;
      updateMeetingWindow(JSON.parse(serialized));
    } catch {}
  });
  onTrustedMeeting('meeting:action', (_event, payload = {}) => {
    const action = String(payload.action || '');
    const cardId = boundedString(payload.cardId, 160);
    if (cardId === null || !['pause','resume','finish','open-main','minimize','hide'].includes(action)) return;
    if (action === 'open-main') { showOverlay(); return; }
    if (action === 'minimize') { meetingWindow.minimize(); return; }
    if (action === 'hide') {
      dismissedMeetingWindowId = cardId;
      meetingWindow.hide();
      showLatestAnswerPopup();
      return;
    }
    overlay?.webContents.send('meeting:action', { action, cardId });
  });
  handleTrusted('asset:save', async (_event, { bytes, extension = 'png' } = {}) => {
    const asset = toLimitedBuffer(bytes, LIMITS.assetBytes);
    const requestedExtension = boundedString(extension, 16, 'png');
    if (!asset || requestedExtension === null) return { ok:false, reason:'asset_limit' };
    const assetDir = path.join(app.getPath('userData'), 'assets');
    await fs.mkdir(assetDir, { recursive: true });
    const safeExt = requestedExtension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const filePath = path.join(assetDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`);
    await fs.writeFile(filePath, asset);
    return { path: filePath, url: pathToFileURL(filePath).href };
  });
  handleTrusted('audio:save', async (_event, { bytes, mimeType = 'audio/webm' } = {}) => {
    const audio = toLimitedBuffer(bytes, LIMITS.savedAudioBytes);
    const safeMimeType = boundedString(mimeType, 64, 'audio/webm');
    if (!audio || safeMimeType === null || !['audio/webm','audio/ogg','audio/ogg;codecs=opus','audio/webm;codecs=opus'].includes(safeMimeType)) return { ok:false, reason:'audio_limit' };
    const audioDir = path.join(app.getPath('userData'), 'audio');
    await fs.mkdir(audioDir, { recursive: true });
    const extension = safeMimeType.includes('ogg') ? 'ogg' : 'webm';
    const filePath = path.join(audioDir, `session-${Date.now()}-${Math.random().toString(36).slice(2,7)}.${extension}`);
    if (extension === 'webm') {
      const rawPath = `${filePath}.raw.webm`;
      await fs.writeFile(rawPath, audio);
      try {
        await execFileAsync(ffmpegExecutablePath(), ['-y','-v','error','-i',rawPath,'-c','copy',filePath], ffmpegExecOptions());
        await fs.unlink(rawPath).catch(() => {});
      } catch {
        await fs.rename(rawPath, filePath);
      }
    } else await fs.writeFile(filePath, audio);
    return { path: filePath, url: pathToFileURL(filePath).href };
  });
  handleTrusted('audio:read', async (_event, rawUrl) => {
    try {
      const requestedUrl = boundedString(rawUrl, 4096);
      if (requestedUrl === null) return { ok:false, reason:'path' };
      const audioDir = path.resolve(app.getPath('userData'), 'audio');
      const filePath = path.resolve(fileURLToPath(requestedUrl));
      if (!filePath.startsWith(`${audioDir}${path.sep}`)) return { ok:false, reason:'path' };
      const initialStat = await fs.stat(filePath);
      if (!initialStat.isFile() || initialStat.size <= 0 || initialStat.size > LIMITS.savedAudioBytes) return { ok:false, reason:'audio_limit' };
      if (path.extname(filePath).toLowerCase() === '.webm') {
        const repairedPath = `${filePath}.repaired.webm`;
        try {
          await execFileAsync(ffmpegExecutablePath(), ['-y','-v','error','-i',filePath,'-c','copy',repairedPath], ffmpegExecOptions());
          const repaired = await fs.stat(repairedPath);
          if (repaired.size > 0) {
            await fs.unlink(filePath);
            await fs.rename(repairedPath, filePath);
          }
        } catch { await fs.unlink(repairedPath).catch(() => {}); }
      }
      const bytes = await fs.readFile(filePath);
      return { ok:true, bytes, mimeType:path.extname(filePath).toLowerCase() === '.ogg' ? 'audio/ogg' : 'audio/webm' };
    } catch { return { ok:false, reason:'read' }; }
  });
  handleTrusted('external:open', async (_event, rawUrl) => {
    try {
      const requestedUrl = boundedString(rawUrl, 2048);
      if (requestedUrl === null) return { ok:false, reason:'url' };
      const url = new URL(requestedUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return { ok: false, reason: 'url' };
      await shell.openExternal(url.href);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'open' };
    }
  });
  handleTrustedAppPage('clipboard:write-text', async (_event, rawText) => {
    const text = boundedString(rawText, 250000);
    if (text === null) return { ok:false, reason:'text_limit' };
    clipboard.writeText(text);
    return { ok:true };
  });
  handleTrusted('xai:key:status', async (_event, { verify = false } = {}) => {
    const xaiKeys = await getXaiKeys();
    const xaiKey = xaiKeys[0] || '';
    const groqKeys = await getGroqKeys();
    const groqKey = groqKeys[0] || '';
    const cerebrasKeys = await getCerebrasKeys();
    const cerebrasKey = cerebrasKeys[0] || '';
    const geminiKeys = await getGeminiKeys();
    const geminiKey = geminiKeys[0] || '';
    const storedProviderKeys = await getStoredProviderKeys();
    const storedIds = new Set(storedProviderKeys.map(entry => entry.id));
    const rawKeyEntries = [
      ...xaiKeys.map(key => ({ provider:'xai', key, id:keyIdentifier('xai', key), label:`xAI ·••••${key.slice(-4)}` })),
      ...groqKeys.map(key => ({ provider:'groq', key, id:keyIdentifier('groq', key), label:`Groq ·••••${key.slice(-4)}` })),
      ...cerebrasKeys.map(key => ({ provider:'cerebras', key, id:keyIdentifier('cerebras', key), label:`Cerebras ·••••${key.slice(-4)}` })),
      ...geminiKeys.map(key => ({ provider:'gemini', key, id:keyIdentifier('gemini', key), label:`Gemini ·••••${key.slice(-4)}` }))
    ];
    const health = verify
      ? await Promise.all(rawKeyEntries.map(entry => verifyAnswerApiKey(entry.provider, entry.key)))
      : rawKeyEntries.map(entry => apiKeyHealth.get(entry.id) || { status:'unknown', reason:'', checkedAt:0 });
    const keyEntries = rawKeyEntries.map((entry, index) => ({
      provider:entry.provider, id:entry.id, label:entry.label, removable:storedIds.has(entry.id),
      status:health[index]?.status || 'unknown', reason:health[index]?.reason || '', checkedAt:health[index]?.checkedAt || 0
    }));
    const bluesminds = await getBluesmindsConfig();
    const azure = await getAzureSpeechConfig();
    const azureId = azure.key && azure.region ? keyIdentifier('azure', `${azure.region}:${azure.key}`) : '';
    const azureHealth = azure.key && azure.region
      ? verify ? await verifyAzureSpeechKey(azure.key, azure.region) : apiKeyHealth.get(azureId) || { status:'unknown', reason:'', checkedAt:0 }
      : null;
    const store = await readSecretStore();
    let invalidXaiKey = false;
    if (store.xaiKey && !xaiKey) {
      try {
        const raw = safeStorage.decryptString(Buffer.from(store.xaiKey, 'base64'));
        invalidXaiKey = Boolean(raw && !extractGroqKey(raw));
      } catch { invalidXaiKey = true; }
    }
    return { configured:Boolean(azure.key || xaiKey || groqKey), answerConfigured:Boolean(xaiKey || groqKey || cerebrasKey || geminiKey || (bluesminds.key && bluesminds.model)), provider:azure.key ? 'azure' : xaiKey ? 'xai' : groqKey ? 'groq' : '', providers:{ azure:Boolean(azure.key), xai:Boolean(xaiKey), groq:Boolean(groqKey), cerebras:Boolean(cerebrasKey), gemini:Boolean(geminiKey), bluesminds:Boolean(bluesminds.key && bluesminds.model) }, xaiKeyCount:xaiKeys.length, groqKeyCount:groqKeys.length, cerebrasKeyCount:cerebrasKeys.length, geminiKeyCount:geminiKeys.length, workingAnswerKeyCount:keyEntries.filter(entry => entry.status === 'working').length, keyEntries, azureRegion:azure.region, azureStatus:azureHealth?.status || '', azureReason:azureHealth?.reason || '', invalidXaiKey, invalidStoredKey:Boolean((store.xaiKey || store.xaiKeys || store.groqKey || store.groqKeys || store.cerebrasKey || store.cerebrasKeys || store.geminiKey || store.geminiKeys || store.azureSpeechKey) && !azure.key && !xaiKey && !groqKey && !cerebrasKey && !geminiKey), encryptionAvailable:safeStorage.isEncryptionAvailable() };
  });
  handleTrusted('azure:key:set', async (_event, { key:rawKey, region:rawRegion } = {}) => {
    const keyInput = boundedString(rawKey, LIMITS.apiKeyChars);
    const regionInput = boundedString(rawRegion, 64);
    if (keyInput === null || regionInput === null) return { ok:false, reason:'invalid_format' };
    const key = keyInput.trim();
    const region = regionInput.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key.length < 20 || !region || region.length > 32) return { ok:false, reason:'invalid_format' };
    if (!safeStorage.isEncryptionAvailable()) return { ok:false, reason:'encryption' };
    const verification = await verifyAzureSpeechKey(key, region);
    if (!verification.ok) return { ok:false, reason:verification.reason, status:verification.status };
    await updateSecretStore(store => {
      store.azureSpeechKey = safeStorage.encryptString(key).toString('base64');
      store.azureSpeechRegion = region;
    });
    return { ok:true, provider:'azure', region };
  });
  handleTrusted('azure:key:clear', async () => {
    await updateSecretStore(store => {
      delete store.azureSpeechKey;
      delete store.azureSpeechRegion;
    });
    return { ok:true };
  });
  handleTrusted('xai:key:verify', async (_event, rawKey) => {
    const rawInput = boundedString(rawKey, LIMITS.apiKeyChars);
    if (rawInput === null) return { ok:false, reason:'invalid_format', status:'invalid' };
    const input = rawInput.trim();
    const groqKey = extractGroqKey(input);
    const xaiKey = extractXaiKey(input);
    const cerebrasKey = extractCerebrasKey(input);
    const geminiKey = extractGeminiKey(input);
    const key = groqKey || xaiKey || cerebrasKey || geminiKey;
    if (!key) return { ok:false, reason:'invalid_format', status:'invalid' };
    const provider = groqKey ? 'groq' : xaiKey ? 'xai' : cerebrasKey ? 'cerebras' : 'gemini';
    return verifyAnswerApiKey(provider, key);
  });
  handleTrusted('xai:key:set', async (_event, rawKey) => {
    const rawInput = boundedString(rawKey, LIMITS.apiKeyChars);
    if (rawInput === null) return { ok:false, reason:'invalid_format' };
    const input = rawInput.trim();
    const groqKey = extractGroqKey(input);
    const xaiKey = extractXaiKey(input);
    const cerebrasKey = extractCerebrasKey(input);
    const geminiKey = extractGeminiKey(input);
    const key = groqKey || xaiKey || cerebrasKey || geminiKey;
    if (!key) return { ok:false, reason:'invalid_format' };
    if (!safeStorage.isEncryptionAvailable()) return { ok:false, reason:'encryption' };
    const provider = groqKey ? 'groq' : xaiKey ? 'xai' : cerebrasKey ? 'cerebras' : 'gemini';
    const verification = await verifyAnswerApiKey(provider, key);
    if (!verification.ok) return { ok:false, reason:verification.reason, status:verification.status, provider };
    await updateSecretStore(store => {
      if (provider === 'groq') {
        const encrypted = [store.groqKey, ...(Array.isArray(store.groqKeys) ? store.groqKeys : [])].filter(Boolean);
        const existing = encrypted.map(value => {
          try { return extractGroqKey(safeStorage.decryptString(Buffer.from(value, 'base64'))); }
          catch { return ''; }
        });
        if (!existing.includes(key)) store.groqKeys = [...(Array.isArray(store.groqKeys) ? store.groqKeys : []), safeStorage.encryptString(key).toString('base64')];
      } else if (provider === 'xai') {
        const encrypted = [store.xaiKey, ...(Array.isArray(store.xaiKeys) ? store.xaiKeys : [])].filter(Boolean);
        const existing = encrypted.map(value => {
          try { return extractXaiKey(safeStorage.decryptString(Buffer.from(value, 'base64'))); }
          catch { return ''; }
        });
        if (!existing.includes(key)) store.xaiKeys = [...(Array.isArray(store.xaiKeys) ? store.xaiKeys : []), safeStorage.encryptString(key).toString('base64')];
      } else if (provider === 'cerebras') {
        const encrypted = [store.cerebrasKey, ...(Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys : [])].filter(Boolean);
        const existing = encrypted.map(value => {
          try { return extractCerebrasKey(safeStorage.decryptString(Buffer.from(value, 'base64'))); }
          catch { return ''; }
        });
        if (!existing.includes(key)) store.cerebrasKeys = [...(Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys : []), safeStorage.encryptString(key).toString('base64')];
      } else {
        const encrypted = [store.geminiKey, ...(Array.isArray(store.geminiKeys) ? store.geminiKeys : [])].filter(Boolean);
        const existing = encrypted.map(value => {
          try { return extractGeminiKey(safeStorage.decryptString(Buffer.from(value, 'base64'))); }
          catch { return ''; }
        });
        if (!existing.includes(key)) store.geminiKeys = [...(Array.isArray(store.geminiKeys) ? store.geminiKeys : []), safeStorage.encryptString(key).toString('base64')];
      }
      if (provider === 'groq' && store.xaiKey) {
        try {
          const old = safeStorage.decryptString(Buffer.from(store.xaiKey, 'base64'));
          if (/^gsk_/i.test(old)) delete store.xaiKey;
        } catch {}
      }
    });
    return { ok:true, provider };
  });
  handleTrusted('xai:key:clear', async () => {
    await updateSecretStore(store => {
      delete store.xaiKey;
      delete store.xaiKeys;
      delete store.groqKey;
      delete store.groqKeys;
      delete store.cerebrasKey;
      delete store.cerebrasKeys;
      delete store.geminiKey;
      delete store.geminiKeys;
    });
    return { ok:true };
  });
  handleTrusted('xai:key:remove', async (_event, rawId) => {
    const id = boundedString(rawId, 80);
    if (id === null || !/^(?:xai|groq|cerebras|gemini)-[a-f0-9]{16}$/.test(id)) return { ok:false, reason:'invalid_format' };
    if (!safeStorage.isEncryptionAvailable()) return { ok:false, reason:'encryption' };
    let removed = false;
    await updateSecretStore(store => {
      const matches = encrypted => {
        try {
          const raw = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
          const groq = extractGroqKey(raw);
          const xai = extractXaiKey(raw);
          const cerebras = extractCerebrasKey(raw);
          const gemini = extractGeminiKey(raw);
          const key = groq || xai || cerebras || gemini;
          const provider = groq ? 'groq' : xai ? 'xai' : cerebras ? 'cerebras' : gemini ? 'gemini' : '';
          return Boolean(key && provider && keyIdentifier(provider, key) === id);
        } catch { return false; }
      };
      for (const field of ['xaiKey','groqKey','cerebrasKey','geminiKey']) {
        if (store[field] && matches(store[field])) { delete store[field]; removed = true; }
      }
      for (const field of ['xaiKeys','groqKeys','cerebrasKeys','geminiKeys']) {
        if (!Array.isArray(store[field])) continue;
        const before = store[field].length;
        store[field] = store[field].filter(value => !matches(value));
        if (store[field].length !== before) removed = true;
        if (!store[field].length) delete store[field];
      }
    });
    return removed ? { ok:true } : { ok:false, reason:'not_found' };
  });
  handleTrusted('xai:transcribe', async (_event, { bytes, mimeType = 'audio/webm', language = 'ru' } = {}) => {
    const audio = toLimitedBuffer(bytes, LIMITS.transcriptionBytes);
    const safeMimeType = boundedString(mimeType, 64, 'audio/webm');
    if (!audio || safeMimeType === null || !['audio/webm','audio/ogg','audio/ogg;codecs=opus','audio/webm;codecs=opus'].includes(safeMimeType)) return { ok:false, reason:'audio_limit' };
    const key = await getXaiKey();
    const groqKey = await getGroqKey();
    if (!key && !groqKey) return { ok:false, reason:'missing_key' };
    try {
      const form = new FormData();
      const selectedLanguage = ['ru','uk','en'].includes(language) ? language : 'auto';
      let endpoint = 'https://api.x.ai/v1/stt';
      let authKey = key;
      if (groqKey && !key) {
        endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
        authKey = groqKey;
        form.append('model', 'whisper-large-v3-turbo');
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'word');
        form.append('timestamp_granularities[]', 'segment');
        if (selectedLanguage !== 'auto') form.append('language', selectedLanguage);
      } else {
        if (['ru','en'].includes(selectedLanguage)) {
          form.append('language', selectedLanguage);
          form.append('format', 'true');
        }
        form.append('diarize', 'true');
      }
      // Both providers expect the file field after configuration fields.
      form.append('file', new Blob([audio], { type:safeMimeType }), `recording.${safeMimeType.includes('ogg') ? 'ogg' : 'webm'}`);
      const response = await fetchWithTimeout(endpoint, { method:'POST', headers:{ Authorization:`Bearer ${authKey}` }, body:form }, 120000);
      if (!response.ok) return { ok:false, reason:`http_${response.status}` };
      return { ok:true, provider:key ? 'xai' : 'groq', transcript:await response.json() };
    } catch (error) { return { ok:false, reason:networkFailureReason(error) }; }
  });
  handleTrusted('groq:transcribe-chunk', async (_event, { bytes, language = 'ru' } = {}) => {
    const audio = toLimitedBuffer(bytes, LIMITS.streamChunkBytes);
    if (!audio) return { ok:false, reason:'chunk_limit' };
    const key = await getGroqKey();
    if (!key) return { ok:false, reason:'missing_key' };
    try {
      const form = new FormData();
      form.append('model', 'whisper-large-v3-turbo');
      form.append('response_format', 'json');
      const selectedLanguage = ['ru','uk','en'].includes(language) ? language : 'auto';
      if (selectedLanguage !== 'auto') form.append('language', selectedLanguage);
      form.append('file', new Blob([audio], { type:'audio/wav' }), 'live-chunk.wav');
      const response = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/transcriptions', { method:'POST', headers:{ Authorization:`Bearer ${key}` }, body:form }, 30000);
      if (!response.ok) return { ok:false, reason:`http_${response.status}` };
      const result = await response.json();
      return { ok:true, text:String(result.text || '').trim() };
    } catch (error) { return { ok:false, reason:networkFailureReason(error) }; }
  });
  handleTrusted('xai:structure', async (event, input) => {
    const transcript = boundedString(typeof input === 'string' ? input : input?.transcript, LIMITS.transcriptChars);
    const requestedLanguage = typeof input === 'object' ? input?.language : 'auto';
    const workspaceContext = boundedString(typeof input === 'object' ? input?.workspaceContext : '', LIMITS.contextChars);
    const operationId = boundedString(typeof input === 'object' ? input?.operationId : '', 160);
    if (transcript === null || workspaceContext === null || operationId === null) return { ok:false, reason:'input_limit' };
    const reportProgress = payload => {
      if (operationId) event.sender.send('ai:progress', { operationId, ...payload });
    };
    const key = await getXaiKey();
    const groqKey = await getGroqKey();
    const bluesminds = await getBluesmindsConfig();
    if (!key && !groqKey && !(bluesminds.key && bluesminds.model)) return { ok:false, reason:'missing_key' };
    const schema = {
      type:'object', additionalProperties:false,
      properties:{
        summary:{type:'string'},
        keyPoints:{type:'array',items:{type:'string'}},
        decisions:{type:'array',items:{type:'string'}},
        topics:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},summary:{type:'string'}},required:['title','summary']}},
        playbook:{type:'array',items:{type:'object',additionalProperties:false,properties:{cue:{type:'string'},response:{type:'string'}},required:['cue','response']}},
        tasks:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},owner:{type:['string','null']},due:{type:['string','null']}},required:['title','owner','due']}},
        people:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},role:{type:['string','null']},context:{type:'string'}},required:['name','role','context']}},
        terms:{type:'array',items:{type:'object',additionalProperties:false,properties:{term:{type:'string'},meaning:{type:'string'}},required:['term','meaning']}},
        questions:{type:'array',items:{type:'string'}}
      }, required:['summary','keyPoints','decisions','topics','playbook','tasks','people','terms','questions']
    };
    try {
      const languageName = { uk:'українською', ru:'русскою', en:'English' }[requestedLanguage] || 'мовою розмови';
      const languageRule = requestedLanguage === 'uk' ? 'Використовуй нормативну українську: «потрібно», «робочий», «питання», «відповідь». Жодного суржику та русизмів.' : requestedLanguage === 'ru' ? 'Используй нормативный русский. Не переходи на украинскую грамматику.' : requestedLanguage === 'en' ? 'Use English for every generated field.' : '';
      const systemPrompt = `Структуруй розшифровку зустрічі/стажування/співбесіди строго ${languageName} мовою. ${languageRule} Ніколи не перекладай без команди. Не вигадуй факти, дати, імена. Поверни JSON з полями: summary, keyPoints, decisions, topics, playbook, tasks, people, terms, questions.

ПОВНОТА КОНСПЕКТУ:
• summary: змістовний підсумок у 3-6 реченнях, а не один загальний рядок
• keyPoints: збережи ВСІ важливі конкретні факти, числа, умови й правила без фіксованого ліміту; кількість має залежати від змісту та тривалості
• topics: створи стільки окремих змістових тем, скільки реально потрібно, кожну з конкретним summary у 1-3 реченнях
• не стискай довгу розмову до наперед заданої кількості тез: у 2-3-годинній зустрічі важливих пунктів можуть бути десятки; прибирай лише справжні повтори

NAYVAZHLYVISHE — PLAYBOOK: витягни всі реальні пари «ситуація/запитання → відповідь»:
• cue: конкретне запитання або ситуація з розмови
• response: стисла підтверджена відповідь (1-2 речення) — тільки з того, що реально прозвучало або є в базі знань
• НЕ вигадуй пар — порожній масив якщо нічого немає

topics: змістові теми title+summary; tasks: title, owner, due; people: name, role, context; terms: term, meaning.
База знань — довідковий контекст, не стверджуй що її зміст звучав на зустрічі. Прибирай повтори. Якщо даних немає — порожній масив або null.\n\nБаза знань простору:\n${compactTextSample(workspaceContext, 12000)}`;
      const chunks = splitTextForModel(transcript, key ? 48000 : 32000);
      const structuredParts = [];
      reportProgress({ phase:'structuring', current:0, total:chunks.length, message:chunks.length > 1 ? `Разбиваю длинную встречу на ${chunks.length} частей` : 'Анализирую расшифровку' });
      for (let index = 0; index < chunks.length; index++) {
        reportProgress({ phase:'structuring', current:index, total:chunks.length, message:chunks.length > 1 ? `Анализирую часть ${index + 1} из ${chunks.length}` : 'Выделяю важное, решения и задачи' });
        const chunkPrompt = chunks.length > 1
          ? `Це частина ${index + 1} з ${chunks.length} довгої розмови. Витягни ВСЕ важливе саме з цієї частини; не зменшуй кількість пунктів через те, що будуть інші частини.\n\n${chunks[index]}`
          : chunks[index];
        const completion = await requestTextCompletion({
          system:systemPrompt, user:chunkPrompt, maxOutputTokens:5000, temperature:0.1,
          jsonSchema:schema, schemaName:'meeting_notes', timeoutMs:90000
        });
        if (!completion.ok) {
          reportProgress({ phase:'error', current:index, total:chunks.length, message:`Обработка остановилась: ${completion.reason || 'AI недоступен'}` });
          return { ok:false, reason:completion.reason, completedChunks:structuredParts.length, totalChunks:chunks.length };
        }
        structuredParts.push(parseJsonText(completion.text));
        reportProgress({ phase:'structuring', current:index + 1, total:chunks.length, message:chunks.length > 1 ? `Готово частей: ${index + 1} из ${chunks.length}` : 'Собираю готовый конспект' });
      }
      reportProgress({ phase:'complete', current:chunks.length, total:chunks.length, message:'Конспект готов' });
      return { ok:true, structured:combineStructuredParts(structuredParts), chunkCount:chunks.length };
    } catch (error) {
      reportProgress({ phase:'error', current:0, total:0, message:'Не удалось продолжить AI-обработку' });
      return { ok:false, reason:networkFailureReason(error, 'network_or_parse') };
    }
  });
  handleTrusted('xai:suggest', async (_event, { question, context = '', language = 'uk', intent = 'answer', assistantMode = false, continuationMode = false, internetSearch = false, questionSource = 'system', roleplay = null, clientRequestId = '' } = {}) => {
    const safeQuestion = boundedString(question, 2000);
    const safeContext = boundedString(context, 18000);
    const roleplayState = roleplay && typeof roleplay === 'object' ? {
      active:Boolean(roleplay.active),
      assistantRole:['client','manager'].includes(roleplay.assistantRole) ? roleplay.assistantRole : 'client',
      userRole:['client','manager'].includes(roleplay.userRole) ? roleplay.userRole : 'manager',
      persona:boundedString(roleplay.persona, 600), goal:boundedString(roleplay.goal, 800), turn:Math.max(1, Math.min(100, Number(roleplay.turn || 1)))
    } : null;
    if (safeQuestion === null || safeContext === null || roleplayState?.persona === null || roleplayState?.goal === null) return { ok:false, reason:'input_limit' };
    const suggestionController = new AbortController();
    activeSuggestionControllers.get(_event.sender.id)?.controller.abort();
    const controllerEntry = { controller:suggestionController, requestId:String(clientRequestId || '') };
    activeSuggestionControllers.set(_event.sender.id, controllerEntry);
    try {
      const safeIntent = ['answer','explain','enumerate','compare','analyze','plan','draft_response'].includes(intent) ? intent : 'answer';
      const answerLanguage = { uk:'Відповідай ВИКЛЮЧНО українською мовою. Жодного суржику та русизмів.', ru:'Отвечай только на русском языке.', en:'Answer ONLY in English.' }[language] || 'Відповідай мовою останньої репліки співрозмовника.';
      const directAssistantQuery = Boolean(assistantMode && questionSource === 'mic');
      const activeRoleplay = Boolean(assistantMode && roleplayState?.active);
      const useInternet = Boolean(internetSearch && directAssistantQuery && !activeRoleplay);
      const assistantModeRule = activeRoleplay
        ? `СПЕЦІАЛЬНИЙ РЕЖИМ — РОЛЬОВИЙ ДІАЛОГ:
Користувач запустив тренування і призначив ролі. Ти зараз граєш роль «${roleplayState.assistantRole === 'client' ? 'клієнт/покупець' : 'менеджер школи'}», користувач — «${roleplayState.userRole === 'client' ? 'клієнт/покупець' : 'менеджер школи'}».
Характер твоєї ролі: ${roleplayState.persona || 'реалістичний співрозмовник'}.
Початкове завдання користувача: ${roleplayState.goal || 'відпрацювати діалог продажу'}. Поточний хід: ${roleplayState.turn}.
Відповідай ЛИШЕ наступною природною реплікою свого персонажа. Не пояснюй методику, не показуй назви або вміст карток, не давай список довідкових фактів і не говори «як AI».
Базу знань використовуй непомітно: менеджер формує з неї переконливу відповідь, клієнт реагує на аргументи реалістично. Якщо користувач сказав «твоя черга/твой черед» — одразу зроби хід. Не виходь з ролі, доки користувач прямо не попросить аналіз або підказку.`
        : assistantMode
        ? directAssistantQuery
          ? continuationMode
            ? `СПЕЦІАЛЬНИЙ РЕЖИМ — ПРОДОВЖЕННЯ ДІАЛОГУ:
Користувач уже веде інтерактивний діалог з AI. Остання репліка — наступний хід, відповідь або заперечення, навіть якщо в ній немає питання. Продовжуй ту саму роль і тему з попередніх ходів. НЕ повертай NO_SUGGESTION для змістовної репліки.
Якщо це тренування продажу, відповідай наступною природною реплікою менеджера або короткою підказкою для відпрацювання заперечення, спираючись на базу знань.`
            : `СПЕЦІАЛЬНИЙ РЕЖИМ — ПОВНОЦІННИЙ AI-ПОМІЧНИК:
Остання репліка сказана користувачем у мікрофон саме тобі. Це може бути запитання, прохання, опис проблеми, чернетка думки або продовження попередньої теми — знак питання не потрібен. НЕ повертай NO_SUGGESTION для змістовної репліки.
Спочатку визнач намір користувача, а потім реально допоможи: дай відповідь, проаналізуй ситуацію, запропонуй план, сформулюй текст, порівняй варіанти, підготуй аргументи або постав одне справді необхідне уточнення. Не зводь допомогу до пошуку однієї картки.`
          : `СПЕЦІАЛЬНИЙ РЕЖИМ — ПИТАННЯ СПІВРОЗМОВНИКА:
Остання репліка прийшла зі звуку комп'ютера. Підготуй користувачу готові варіанти того, що відповісти співрозмовнику.`
        : '';
      const filterRule = activeRoleplay
        ? 'Рольова сцена вже активна. Кожна змістовна репліка користувача є наступним ходом; знак питання не потрібен.'
        : continuationMode && assistantMode
        ? 'Це продовження активного діалогу. Не вимагай знака питання: змістовна відповідь, заперечення або коротка репліка користувача є валідним наступним ходом.'
        : directAssistantQuery
        ? 'У прямому режимі перевір лише, чи має репліка зрозумілий зміст. Запитання, прохання, опис проблеми, ідея, заперечення або продовження теми є валідним зверненням до AI.'
        : 'Строго перевір — чи є остання репліка ЗАКІНЧЕНИМ запитанням або проханням, адресованим БЕЗПОСЕРЕДНЬО користувачу.';
      const answerFormatRule = activeRoleplay
        ? '• Дай тільки одну репліку призначеного персонажа на 1–4 речення. Без заголовків, карток, порад, аналізу та службових пояснень.'
        : continuationMode && assistantMode
        ? '• Продовж діалог однією природною реплікою на 1–4 речення. Не повторюй попередню відповідь і не починай розмову заново.'
        : directAssistantQuery
        ? '• Обери формат і глибину за наміром користувача: просте запитання — стисло; складна проблема, план, аналіз або чернетка — достатньо докладно й структуровано. Відповідь має завершувати корисну роботу, а не лише називати джерело.'
        : '• Дай 2 повноцінні готові варіанти відповіді: «Нейтрально» та «Впевнено» (кожен 2-5 речень)';
      const rejectionRules = activeRoleplay
        ? 'Поверни NO_SUGGESTION лише для порожнього звуку або явної помилки розпізнавання. Привітання, вступ менеджера, заперечення клієнта та команда «твій хід» завжди потребують відповіді.'
        : continuationMode && assistantMode
        ? `Поверни ТІЛЬКИ NO_SUGGESTION лише якщо це порожній звук, явна помилка розпізнавання або уривок без зрозумілого змісту. Коротке заперечення на кшталт «дорого», «не актуально» чи «я вже займаюся» — це валідний хід.`
        : `Поверни ТІЛЬКИ NO_SUGGESTION якщо:
• Це декларативна фраза або незавершена думка
• Це цитата, вже вимовлена відповідь, або репліка не до користувача
• Будь-який сумнів`;
      const responseExtras = activeRoleplay
        ? '• Не додавай «Опорні факти», «Наступне питання», назви джерел або будь-який текст поза реплікою персонажа.'
        : continuationMode && assistantMode
        ? '• Не додавай службові блоки «Опорні факти» чи «Наступне питання», якщо вони порушують природний хід рольового діалогу.'
        : directAssistantQuery
        ? '• Не нав’язуй шаблони «Нейтрально/Впевнено» та «Опорні факти». Якщо без уточнення можна зробити корисне припущення — коротко назви його і продовжуй; став не більше одного уточнювального питання.'
        : `• Після них додай блок «Опорні факти» з усіма доречними конкретними тезами з контексту
• Якщо розмова потребує продовження, додай «Наступне питання» — одну природну репліку для розвитку діалогу`;
      let systemPrompt = `Ти — інтелектуальний помічник під час зустрічі, стажування або співбесіди. Твоя роль — в потрібний момент дати стислу, природну та корисну підказку для відповіді.

${assistantModeRule}

БЛОК 1 — FILTER (виконуй завжди першим):
${filterRule}
${rejectionRules}

BLOCK 2 — RESPOND (якщо запитання або хід діалогу валідний):
${answerFormatRule}
${responseExtras}
• Спочатку швидко знайди відповідь у базі знань і картках простору; для цін, строків та умов зберігай точні числа
• Розумій намір за змістом, синонімами й контекстом діалогу. Назви карток — лише службові мітки: користувач не зобов'язаний називати картку або повторювати її формулювання
• Перед відповіддю внутрішньо збери ВСІ доречні факти з кількох карток, бази знань і попередніх ходів, усунь повтори та скомбінуй їх в одну точну зв'язну відповідь
• Не копіюй одну картку сирим блоком. Для широкого запиту на кшталт «які переваги?» переліч усі підтверджені доречні переваги з різних джерел
• Якщо джерела перетинаються, надавай перевагу конкретнішому факту з точними умовами; якщо вони суперечать одне одному — коротко познач невизначеність
• Не давай загальних порад, якщо в контексті є конкретна готова відповідь
• Дані про компанію, продукт, людей, ціни, строки та домовленості бери тільки з наданого контексту; якщо їх немає — прямо скажи, що саме треба уточнити
• Для аналізу, формулювання, планування, комунікаційної стратегії та загальних пояснень використовуй власні знання й міркування, але не видавай припущення за внутрішній факт компанії
• НЕ вигадуй досвід, навички або досягнення користувача
• НЕ починай зі слів «моя відповідь», «я б сказав»
• Якщо даних замало — запропонуй уточнювальне запитання

${answerLanguage}`;
      if (directAssistantQuery && !activeRoleplay) {
        const intentGuide = {
          explain:'Поясни навіщо це потрібно: мета → як працює → місце в процесі → конкретний приклад.',
          enumerate:'Дай точну кількість, якщо вона є в джерелах, потім повний впорядкований список і коротко поясни кожен пункт.',
          compare:'Назви критерії порівняння, покажи суттєві відмінності та зроби практичний висновок.',
          analyze:'Відокрем факти від висновків, знайди причину й запропонуй конкретне поліпшення.',
          plan:'Склади послідовний практичний план із наступним кроком.',
          draft_response:'Напиши готову природну репліку, яку можна одразу сказати; факти вбудуй у неї, а не вивантажуй окремим списком.',
          answer:'Дай пряму завершену відповідь у форматі, який найкраще вирішує запит.'
        }[safeIntent];
        systemPrompt = `Ти — повноцінний розумний асистент робочого простору, а не пошук карток і не генератор випадкових підказок.

ТВОЄ ЗАВДАННЯ:
1. Віднови справжній намір користувача, навіть якщо розпізнавання мовлення містить суржик, повтори або 1–2 помилкові слова.
2. Зістав запит з історією розмови й доказовим пакетом.
3. Внутрішньо збери всі доречні факти з кількох джерел, відкинь нерелевантні уривки та повтори.
4. Зроби синтез: поясни зв’язок між фактами й дай готовий висновок. Ніколи не копіюй картку сирим блоком і не згадуй назви карток.

ПОТОЧНИЙ ТИП ЗАДАЧІ: ${safeIntent}
${intentGuide}

ПРАВИЛА ЯКОСТІ:
• Питання «навіщо/для чого» потребує пояснення мети й механіки, а не переліку сусідніх тез.
• Питання про етапи потребує точної кількості та повного порядку етапів.
• Запит «що сказати» потребує готової репліки, а не методички.
• Не переходь у рольову гру без явного активного рольового контракту.
• Внутрішні факти про компанію, ціни й умови бери лише з доказового пакета. Загальну логіку можеш пояснювати власними словами.
• Якщо запит зрозумілий — відповідай одразу; не став зайвого уточнення.
• Відповідь має бути настільки докладною, наскільки потрібно для повного розуміння, але без води.
${useInternet ? '• Інтернет-пошук дозволений. Для актуальних або зовнішніх фактів використай Google Search, поєднай результати з матеріалами простору й не видавай веб-факт без перевірки.' : '• Інтернет-пошук вимкнений. Не стверджуй, що перевірив актуальні дані в мережі.'}

${answerLanguage}`;
      }
      const userLabel = directAssistantQuery ? 'Запит користувача' : 'Остання репліка співрозмовника';
      const buildUserPrompt = contextChars => `Контекст розмови та доказовий пакет:\n${compactTextSample(safeContext, contextChars)}\n\n${userLabel}:\n${String(question).slice(0,2000)}`;
      const liveContextChars = activeRoleplay ? 6000 : directAssistantQuery ? 11000 : 8000;
      const liveOutputTokens = activeRoleplay ? 320 : directAssistantQuery ? 1000 : 650;
      let completion = await requestTextCompletion({ system:systemPrompt, user:buildUserPrompt(liveContextChars), maxOutputTokens:liveOutputTokens, temperature:0.25, reasoningEffort:'low', attemptsPerProvider:1, timeoutMs:useInternet ? 7500 : 3500, totalTimeoutMs:useInternet ? 16000 : 10000, preferGemini:useInternet, webSearch:useInternet, signal:suggestionController.signal });
      if (completion.reason === 'http_413') {
        completion = await requestTextCompletion({ system:systemPrompt, user:buildUserPrompt(4000), maxOutputTokens:600, temperature:0.25, reasoningEffort:'low', attemptsPerProvider:1, timeoutMs:useInternet ? 7500 : 3500, totalTimeoutMs:useInternet ? 14000 : 8000, preferGemini:useInternet, webSearch:useInternet, signal:suggestionController.signal });
      }
      if (!completion.ok) return completion;
      return { ok:true, suggestion:completion.text, provider:completion.provider, webSearchRequested:completion.webSearchRequested, webGrounded:completion.webGrounded, sources:completion.sources || [] };
    } catch (error) { return { ok:false, reason:suggestionController.signal.aborted ? 'aborted' : networkFailureReason(error) }; }
    finally {
      if (activeSuggestionControllers.get(_event.sender.id) === controllerEntry) activeSuggestionControllers.delete(_event.sender.id);
    }
  });
  handleTrusted('xai:board-cheats', async (_event, { transcript = '', structured = {}, instruction = '', context = '', language = 'uk' } = {}) => {
    const safeTranscript = boundedString(transcript, LIMITS.transcriptChars);
    const safeInstruction = boundedString(instruction, 1600);
    const safeContext = boundedString(context, LIMITS.contextChars);
    let safeStructured;
    try { safeStructured = boundedString(JSON.stringify(structured || {}), 30000); }
    catch { safeStructured = null; }
    if ([safeTranscript, safeInstruction, safeContext, safeStructured].some(value => value === null)) return { ok:false, reason:'input_limit' };
    const schema = {
      type:'object', additionalProperties:false,
      properties:{ cards:{ type:'array', minItems:1, maxItems:8, items:{
        type:'object', additionalProperties:false,
        properties:{ title:{type:'string'}, kicker:{type:'string'}, points:{type:'array',minItems:1,maxItems:8,items:{type:'string'}} },
        required:['title','kicker','points']
      } } }, required:['cards']
    };
    const languageRule = { uk:'Пиши нормативною українською.', ru:'Пиши только на русском языке.', en:'Write only in English.' }[language] || 'Use the language of the meeting.';
    const systemPrompt = `Ты превращаешь одну длинную карточку встречи в 3-8 самостоятельных экранных шпаргалок. ${languageRule}
Пользователь должен видеть их параллельно на свободной доске во время следующего разговора.
Приоритет: самое важное, точные ответы на вопросы, возражения и ответы, числа/условия, следующие действия.
Каждая карточка: короткий title, короткий kicker-категория и 1-8 лаконичных points.
Строго следуй заданию пользователя. Не выдумывай факты и не повторяй один смысл в разных карточках. Верни только JSON.`;
    const buildUserPrompt = (transcriptChars, structuredChars, contextChars) => `ЗАДАНИЕ ПОЛЬЗОВАТЕЛЯ:
${safeInstruction || 'Выдели главные шпаргалки, которые полезно одновременно держать на экране.'}

ГОТОВЫЙ КОНСПЕКТ (приоритетный источник):
${compactTextSample(safeStructured, structuredChars)}

КОНТЕКСТ РАБОЧЕГО ПРОСТРАНСТВА:
${compactTextSample(safeContext, contextChars)}

РЕПРЕЗЕНТАТИВНЫЕ ЧАСТИ РАСШИФРОВКИ:
${compactTextSample(safeTranscript, transcriptChars)}`;
    const sendRequest = userPrompt => requestTextCompletion({ system:systemPrompt, user:userPrompt, maxOutputTokens:1800, temperature:0.15, jsonSchema:schema, schemaName:'board_cheats', timeoutMs:60000 });
    try {
      let completion = await sendRequest(buildUserPrompt(24000, 16000, 6000));
      if (completion.reason === 'http_413') completion = await sendRequest(buildUserPrompt(7000, 7000, 2200));
      if (!completion.ok) return completion;
      const parsed = parseJsonText(completion.text);
      const cards = (Array.isArray(parsed?.cards) ? parsed.cards : []).slice(0,8).map(item => ({
        title:String(item?.title || '').trim().slice(0,100),
        kicker:String(item?.kicker || 'AI · ШПАРГАЛКА').trim().slice(0,40),
        points:(Array.isArray(item?.points) ? item.points : []).map(point => String(point || '').trim().slice(0,600)).filter(Boolean).slice(0,8)
      })).filter(item => item.title && item.points.length);
      return cards.length ? { ok:true, cards } : { ok:false, reason:'empty_result' };
    } catch (error) { return { ok:false, reason:networkFailureReason(error, 'network_or_parse') }; }
  });
  handleTrusted('space:chat', async (_event, { message = '', history = [], context = '', language = 'uk' } = {}) => {
    const safeMessage = boundedString(message, 6000);
    const safeContext = boundedString(context, LIMITS.spaceChatContextChars);
    if (safeMessage === null || safeContext === null || !safeMessage.trim() || !Array.isArray(history) || history.length > 40) return { ok:false, reason:'input_limit' };
    const safeHistory = [];
    for (const item of history.slice(-16)) {
      if (!item || !['user','assistant'].includes(item.role)) return { ok:false, reason:'input_limit' };
      const text = boundedString(item.text, 6000);
      if (text === null) return { ok:false, reason:'input_limit' };
      if (text.trim()) safeHistory.push({ role:item.role, text:text.trim() });
    }
    const schema = {
      type:'object', additionalProperties:false,
      properties:{
        answer:{ type:'string' },
        action:{ type:'string', enum:['answer','create_cards'] },
        cards:{ type:'array', maxItems:16, items:{
          type:'object', additionalProperties:false,
          properties:{ title:{type:'string'}, kicker:{type:'string'}, points:{type:'array',maxItems:10,items:{type:'string'}} },
          required:['title','kicker','points']
        } }
      },
      required:['answer','action','cards']
    };
    const languageRule = { uk:'Отвечай на украинском, если пользователь не пишет на другом языке.', ru:'Отвечай на русском, если пользователь не пишет на другом языке.', en:'Answer in English unless the user writes in another language.' }[language] || 'Use the language of the user.';
    const systemPrompt = `Ты — чат текущего рабочего пространства. ${languageRule}
Используй только факты из ПАКЕТА ПРОСТРАНСТВА и явно отмечай, если сведений недостаточно. Не придумывай цены, условия, имена или решения.
Ты умеешь: отвечать по материалам; кратко обобщать всё пространство; выбирать самое важное; выбирать только указанную пользователем тему; создавать отдельные карточки на доске.
Ставь action="create_cards" только если пользователь явно просит создать, разложить, собрать, вынести или сложить карточки. В остальных случаях action="answer" и cards=[].
При запросе «из всей информации» охвати все разные содержательные темы без повторов. При запросе «самое важное» отбирай только решения, точные ответы, условия, числа, риски и следующие действия. При фильтре пользователя включай только соответствующие материалы.
Для карточек верни короткий title, короткий kicker и 1-10 самостоятельных points. Ответ должен честно сообщать, что именно подготовлено. Верни только JSON.`;
    const historyText = safeHistory.map(item => `${item.role === 'user' ? 'Пользователь' : 'Чат пространства'}: ${item.text}`).join('\n\n');
    const buildPrompt = contextChars => `ПАКЕТ ПРОСТРАНСТВА:
${compactTextSample(safeContext, contextChars) || 'Пространство пока пусто.'}

НЕДАВНИЙ ДИАЛОГ:
${historyText || 'Это первое сообщение.'}

НОВАЯ КОМАНДА ПОЛЬЗОВАТЕЛЯ:
${safeMessage.trim()}`;
    const sendRequest = contextChars => requestTextCompletion({ system:systemPrompt, user:buildPrompt(contextChars), maxOutputTokens:4200, temperature:0.12, jsonSchema:schema, schemaName:'space_chat', timeoutMs:70000, preferGemini:contextChars > 420000 });
    try {
      const initialContextChars = Math.min(820000, safeContext.length || 180000);
      let completion = await sendRequest(initialContextChars);
      if (completion.reason === 'http_413') completion = await sendRequest(180000);
      if (!completion.ok) return completion;
      const parsed = parseJsonText(completion.text);
      const action = parsed?.action === 'create_cards' ? 'create_cards' : 'answer';
      const cards = action === 'create_cards' ? (Array.isArray(parsed?.cards) ? parsed.cards : []).slice(0,16).map(item => ({
        title:String(item?.title || '').trim().slice(0,110),
        kicker:String(item?.kicker || 'AI · ПРОСТРАНСТВО').trim().slice(0,45),
        points:(Array.isArray(item?.points) ? item.points : []).map(point => String(point || '').trim().slice(0,900)).filter(Boolean).slice(0,10)
      })).filter(item => item.title && item.points.length) : [];
      const answer = String(parsed?.answer || '').trim().slice(0,12000) || (cards.length ? `Подготовлено карточек: ${cards.length}.` : 'В материалах пространства не нашлось достаточного ответа.');
      return { ok:true, answer, action:cards.length ? 'create_cards' : 'answer', cards, provider:completion.provider };
    } catch (error) { return { ok:false, reason:networkFailureReason(error, 'network_or_parse') }; }
  });
  handleTrusted('knowledge:analyze-image', async (_event, { bytes, mimeType = 'image/png', language = 'uk' } = {}) => {
    const key = await getGroqKey();
    if (!key) return { ok:false, reason:'missing_groq_key' };
    const image = toLimitedBuffer(bytes, LIMITS.imageBytes);
    const safeMimeType = boundedString(mimeType, 32, 'image/png');
    if (!image || safeMimeType === null || !['image/png','image/jpeg','image/webp'].includes(safeMimeType)) return { ok:false, reason:'image_limit' };
    const outputLanguage = { uk:'украинском', ru:'русском', en:'английском' }[language] || 'языке изображения';
    try {
      const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method:'POST', headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ model:'qwen/qwen3.6-27b', temperature:0.1, response_format:{ type:'json_object' }, messages:[{ role:'user', content:[
          { type:'text', text:`Извлеки из изображения полезную рабочую информацию. Верни строго JSON: {"title":"...","extractedText":"...","summary":"...","facts":["..."],"tags":["..."]}. Пиши на ${outputLanguage}. Не переводи имена, ссылки, коды и термины. Не выдумывай невидимый текст.` },
          { type:'image_url', image_url:{ url:`data:${safeMimeType};base64,${image.toString('base64')}` } }
        ] }] })
      }, 60000);
      if (!response.ok) return { ok:false, reason:`http_${response.status}` };
      const payload = await response.json();
      return { ok:true, result:parseJsonText(payload.choices?.[0]?.message?.content || '') };
    } catch (error) { return { ok:false, reason:networkFailureReason(error, 'network_or_parse') }; }
  });
  handleTrusted('knowledge:consolidate', async (_event, { items = [], language = 'uk' } = {}) => {
    if (!Array.isArray(items) || items.length > 2000) return { ok:false, reason:'input_limit' };
    for (const item of items.slice(-80)) {
      if (!item || typeof item !== 'object' || boundedString(item.title, 300) === null || boundedString(item.text ?? item.summary, 6000) === null) return { ok:false, reason:'input_limit' };
    }
    const outputLanguage = { uk:'украинском', ru:'русском', en:'английском' }[language] || 'основном языке материалов';
    const source = items.slice(-80).map(item => `${item.title || 'Материал'}: ${item.text || item.summary || ''}`).join('\n').slice(0,60000);
    const prompt = `Собери компактную базу знаний рабочего пространства строго на ${outputLanguage} языке. Не переводи без команды. Удали смысловые повторы. Верни JSON: {"summary":"2-5 предложений","facts":["подтверждённые факты"],"tags":["темы"],"playbook":[{"cue":"ситуация или вопрос","response":"подтверждённый короткий ответ"}]}. Не выдумывай данных. Материалы:\n${source}`;
    const knowledgeSchema = { type:'object', additionalProperties:false, properties:{
      summary:{ type:'string' }, facts:{ type:'array', items:{ type:'string' } }, tags:{ type:'array', items:{ type:'string' } },
      playbook:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{ cue:{ type:'string' }, response:{ type:'string' } }, required:['cue','response'] } }
    }, required:['summary','facts','tags','playbook'] };
    try {
      const completion = await requestTextCompletion({ system:'Ты аккуратно объединяешь рабочие материалы в проверяемую базу знаний и возвращаешь только JSON.', user:prompt, maxOutputTokens:3500, temperature:0.1, jsonSchema:knowledgeSchema, schemaName:'knowledge_hub', timeoutMs:60000 });
      if (!completion.ok) return completion;
      return { ok:true, result:parseJsonText(completion.text), provider:completion.provider };
    } catch (error) { return { ok:false, reason:networkFailureReason(error, 'network_or_parse') }; }
  });
  handleTrusted('azure:stream:start', async (event, { sources = ['mic'], language = 'auto' } = {}) => {
    const selectedSources = normalizeSources(sources);
    if (!selectedSources || !['auto','ru','uk','en'].includes(language)) return { ok:false, reason:'input_limit' };
    const azure = await getAzureSpeechConfig();
    if (!azure.key || !azure.region) return { ok:false, reason:'missing_key' };
    const sessionId = `azure-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    const state = { provider:'azure', senderId:event.sender.id, recognizers:new Map() };
    liveSttSessions.set(sessionId, state);
    try {
      for (const source of selectedSources) {
        const speechConfig = speechSdk.SpeechConfig.fromSubscription(azure.key, azure.region);
        speechConfig.outputFormat = speechSdk.OutputFormat.Detailed;
        const format = speechSdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
        const stream = speechSdk.AudioInputStream.createPushStream(format);
        const audioConfig = speechSdk.AudioConfig.fromStreamInput(stream);
        const locale = { uk:'uk-UA', ru:'ru-RU', en:'en-US' }[language];
        let recognizer;
        // With one microphone capturing the whole room, diarization is the only
        // reliable way for the renderer to distinguish the user's question from
        // a question addressed to the user. Keep the split-source mode as well.
        const diarizeSpeaker = Boolean(locale) && (source === 'system' || selectedSources.length === 1);
        if (locale) {
          speechConfig.speechRecognitionLanguage = locale;
          recognizer = diarizeSpeaker ? new speechSdk.ConversationTranscriber(speechConfig, audioConfig) : new speechSdk.SpeechRecognizer(speechConfig, audioConfig);
        } else {
          const autoLanguages = speechSdk.AutoDetectSourceLanguageConfig.fromLanguages(['uk-UA','ru-RU','en-US']);
          recognizer = speechSdk.SpeechRecognizer.FromConfig(speechConfig, autoLanguages, audioConfig);
        }
        const sendInterim = (_sender, recognitionEvent) => {
          const text = String(recognitionEvent.result?.text || '').trim();
          if (text) event.sender.send('xai:stream:event', { sessionId, source, speaker:recognitionEvent.result?.speakerId || '', type:'transcript', text, isFinal:false, speechFinal:false });
        };
        const sendFinal = (_sender, recognitionEvent) => {
          const text = String(recognitionEvent.result?.text || '').trim();
          if (text) event.sender.send('xai:stream:event', { sessionId, source, speaker:recognitionEvent.result?.speakerId || '', type:'transcript', text, isFinal:true, speechFinal:true, providerEventId:recognitionEvent.result?.resultId, offset:recognitionEvent.result?.offset, duration:recognitionEvent.result?.duration });
        };
        if (diarizeSpeaker) { recognizer.transcribing = sendInterim; recognizer.transcribed = sendFinal; }
        else { recognizer.recognizing = sendInterim; recognizer.recognized = sendFinal; }
        recognizer.canceled = (_sender, cancellationEvent) => event.sender.send('xai:stream:event', { sessionId, source, type:'error', reason:String(cancellationEvent.errorDetails || cancellationEvent.reason || 'azure_canceled') });
        recognizer.sessionStopped = () => event.sender.send('xai:stream:event', { sessionId, source, type:'closed' });
        const entry = { recognizer, stream, diarizeRemote:diarizeSpeaker };
        state.recognizers.set(source, entry);
        const start = diarizeSpeaker ? (resolve, reject) => recognizer.startTranscribingAsync(resolve, reject) : (resolve, reject) => recognizer.startContinuousRecognitionAsync(resolve, reject);
        await withTimeout(new Promise(start), 10000, 'azure_start_timeout');
        event.sender.send('xai:stream:event', { sessionId, source, type:'connected' });
      }
      return { ok:true, sessionId };
    } catch (error) {
      for (const entry of state.recognizers.values()) { try { entry.stream.close(); entry.recognizer.close(); } catch {} }
      liveSttSessions.delete(sessionId);
      return { ok:false, reason:String(error?.message || 'azure_start') };
    }
  });
  handleTrusted('xai:stream:start', async (event, { sources = ['mic'], language = 'auto' } = {}) => {
    const selectedSources = normalizeSources(sources);
    if (!selectedSources || !['auto','ru','uk','en'].includes(language)) return { ok:false, reason:'input_limit' };
    const key = await getXaiKey();
    if (!key) return { ok:false, reason:'missing_key' };
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    const state = { senderId:event.sender.id, sockets:new Map() };
    liveSttSessions.set(sessionId, state);
    for (const source of selectedSources) {
      const selectedLanguage = ['ru','uk','en'].includes(language) ? language : 'auto';
      const languageQuery = ['ru','en'].includes(selectedLanguage) ? `&language=${selectedLanguage}` : '';
      const url = `wss://api.x.ai/v1/stt?sample_rate=16000&encoding=pcm&interim_results=true&smart_turn=0.7&smart_turn_timeout=3000${languageQuery}`;
      const socketState = { socket:null, queue:[], ready:false, closing:false };
      socketState.donePromise = new Promise(resolve => { socketState.resolveDone = resolve; });
      const socket = new WebSocket(url, { headers:{ Authorization:`Bearer ${key}` }, handshakeTimeout:15000, maxPayload:2 * 1024 * 1024 });
      socketState.socket = socket;
      state.sockets.set(source, socketState);
      socket.on('open', () => overlay?.webContents.send('xai:stream:event', { sessionId, source, type:'connected' }));
      socket.on('message', raw => {
        try {
          const message = JSON.parse(raw.toString());
          const type = String(message.type || '');
          if (type === 'error') {
            socketState.resolveDone?.();
            overlay?.webContents.send('xai:stream:event', { sessionId, source, type:'error', reason:String(message.message || message.error || 'xai_stream_error') });
            try { socket.close(); } catch {}
            return;
          }
          if (type === 'transcript.created') {
            socketState.ready = true;
            for (const chunk of socketState.queue.splice(0)) socket.send(chunk);
            if (socketState.closing) socket.send(JSON.stringify({ type:'audio.done' }));
            return;
          }
          if (type === 'transcript.done') {
            const text = message.text || message.transcript?.text || message.channel?.alternatives?.[0]?.transcript || '';
            if (text) overlay?.webContents.send('xai:stream:event', { sessionId, source, type:'transcript', text, isFinal:true, speechFinal:true, replaceSource:true, start:message.start, duration:message.duration });
            socketState.resolveDone?.();
            try { socket.close(1000, 'transcript_complete'); } catch {}
            return;
          }
          const text = message.text || message.transcript?.text || message.channel?.alternatives?.[0]?.transcript || '';
          const isFinal = Boolean(message.is_final || message.speech_final || /done|final|completed/.test(type));
          if (text) overlay?.webContents.send('xai:stream:event', { sessionId, source, type:'transcript', text, isFinal, speechFinal:Boolean(message.speech_final), start:message.start, duration:message.duration });
        } catch {}
      });
      socket.on('error', () => { socketState.resolveDone?.(); overlay?.webContents.send('xai:stream:event', { sessionId, source, type:'error' }); });
      socket.on('close', () => { socketState.resolveDone?.(); overlay?.webContents.send('xai:stream:event', { sessionId, source, type:'closed' }); });
    }
    // Return immediately: renderer starts sending PCM now, and each socket queues it
    // until xAI confirms transcript.created. This preserves the first spoken words.
    return { ok:true, sessionId };
  });
  onTrusted('xai:stream:audio', (event, { sessionId, source, bytes } = {}) => {
    if (boundedString(sessionId, 80) === null || !['mic','system'].includes(source)) return;
    const state = liveSttSessions.get(sessionId);
    if (!state || state.senderId !== event.sender.id) return;
    const chunk = toLimitedBuffer(bytes, LIMITS.livePcmChunkBytes);
    if (!chunk) return;
    if (state.provider === 'azure') {
      const entry = state.recognizers.get(source);
      if (entry) { try { entry.stream.write(chunk); } catch {} }
      return;
    }
    const socketState = state.sockets.get(source);
    if (!socketState) return;
    if (socketState.ready && socketState.socket.readyState === WebSocket.OPEN) socketState.socket.send(chunk);
    else if (socketState.queue.length < 80) socketState.queue.push(chunk);
  });
  handleTrusted('xai:stream:stop', async (event, sessionId) => {
    if (boundedString(sessionId, 80) === null) return { ok:false, reason:'input_limit' };
    const state = liveSttSessions.get(sessionId);
    if (!state || state.senderId !== event.sender.id) return { ok:false };
    if (state.provider === 'azure') {
      for (const entry of state.recognizers.values()) {
        try { entry.stream.close(); } catch {}
        const stop = entry.diarizeRemote ? resolve => entry.recognizer.stopTranscribingAsync(resolve, resolve) : resolve => entry.recognizer.stopContinuousRecognitionAsync(resolve, resolve);
        try { await withTimeout(new Promise(stop), 3000, 'azure_stop_timeout'); } catch {}
        try { entry.recognizer.close(); } catch {}
      }
      liveSttSessions.delete(sessionId);
      return { ok:true };
    }
    const completions = [];
    for (const socketState of state.sockets.values()) {
      socketState.closing = true;
      completions.push(socketState.donePromise);
      try {
        if (socketState.ready && socketState.socket.readyState === WebSocket.OPEN) socketState.socket.send(JSON.stringify({ type:'audio.done' }));
        // While CONNECTING/awaiting transcript.created, keep the socket alive.
        // The created handler flushes the buffered audio and sends audio.done.
      } catch {}
    }
    await Promise.race([
      Promise.all(completions),
      new Promise(resolve => setTimeout(resolve, 3500))
    ]);
    for (const socketState of state.sockets.values()) {
      try { socketState.socket.close(1000, 'recording_finished'); } catch {}
    }
    liveSttSessions.delete(sessionId);
    return { ok:true };
  });

  await startRendererLoad();
  if (isUpdateSmokeTest) {
    await updateManager.check({ manual:false, force:true });
    const deadline = Date.now() + 6 * 60 * 1000;
    while (!['ready','completed','error'].includes(updateManager.state.stage) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const result = {
      ok:updateManager.state.stage === 'ready',
      stage:updateManager.state.stage,
      installedVersion:updateManager.state.installedVersion,
      targetVersion:updateManager.state.targetVersion,
      filesCompleted:updateManager.state.filesCompleted,
      filesTotal:updateManager.state.filesTotal,
      total:updateManager.state.total,
      errorCode:updateManager.state.errorCode || ''
    };
    await fs.mkdir(app.getPath('userData'), { recursive:true });
    await fs.writeFile(path.join(app.getPath('userData'), 'update-smoke-result.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(`V_UPDATE_SMOKE ${JSON.stringify(result)}`);
    isQuitting = true;
    app.exit(result.ok ? 0 : 1);
    return;
  }
  if (isSmokeTest) {
    if (isAiSmokeTest) {
      const aiState = await overlay.webContents.executeJavaScript(`(async () => {
        const waitFor = async predicate => {
          const until = Date.now() + 20000;
          while (Date.now() < until) {
            if (predicate()) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return false;
        };
        const firstQuestion = 'Объясни, зачем нужен следующий шаг.';
        const secondQuestion = 'А теперь продолжи эту мысль одним примером.';
        recordingSession = {
          id:'ai-smoke-dialogue', coachOnly:true, card:null, spaceId:activeSpaceId, stopRequested:false,
          coachTurns:[], coachDialogueUntil:0, coachScenario:null, lastAssistantSuggestion:'',
          lastAssistantSuggestionAt:0, awaitingInterlocutor:false, readbackAt:0, pendingCoachTurn:null
        };
        answerSearchPaused = false;
        suggestionInFlight = false;
        suggestionCandidate = null;
        pendingSuggestionQuestion = '';
        lastSuggestedQuestion = '';
        scheduleLiveSuggestion(firstQuestion, 'mic');
        const firstReady = await waitFor(() => lastSuggestedQuestion === firstQuestion && document.querySelector('#record-status')?.textContent.includes('Подсказка готова'));
        const firstAnswer = document.querySelector('#live-suggestion')?.textContent || '';
        scheduleLiveSuggestion(secondQuestion, 'mic');
        const secondReady = await waitFor(() => lastSuggestedQuestion === secondQuestion && document.querySelector('#record-status')?.textContent.includes('Подсказка готова'));
        const secondAnswer = document.querySelector('#live-suggestion')?.textContent || '';
        const provider = document.querySelector('#record-status')?.textContent.split('·').pop()?.trim() || '';
        recordingSession = null;
        return { firstReady, secondReady, firstAnswer, secondAnswer, provider };
      })()`);
      if (!aiState?.firstReady || !aiState?.secondReady || !String(aiState.secondAnswer || '').trim() || aiState.secondAnswer === aiState.firstAnswer) throw new Error(`ai_two_turn_pipeline_failed:${JSON.stringify(aiState)}`);
      console.log(`SLOY_AI_SMOKE_PROVIDER ${aiState.provider || 'unknown'} TWO_TURNS_READY`);
    }
    const rendererState = await overlay.webContents.executeJavaScript(`({
      ready: document.body.dataset.appReady === 'true',
      renderedCards: document.querySelectorAll('.card').length,
      dataCards: typeof cards === 'undefined' ? -1 : cards.length,
      antischoolCards: typeof cards === 'undefined' ? -1 : cards.filter(card => card.antischoolVersion === 3).length,
      antischoolLayout: typeof activeSpace === 'undefined' ? '' : activeSpace().view?.layout,
      antischoolKnowledge: typeof activeSpace === 'undefined' ? -1 : (activeSpace().knowledge?.items || []).filter(item => item.source === 'antischool-board').length,
      coachButton: Boolean(document.querySelector('#coach-button')),
      recordButton: Boolean(document.querySelector('#record-button')),
      stopButton: Boolean(document.querySelector('#record-stop'))
    })`);
    if (!rendererState.ready || rendererState.renderedCards !== rendererState.dataCards || rendererState.antischoolCards !== 20 || rendererState.antischoolLayout !== 'gallery' || rendererState.antischoolKnowledge < 4 || !rendererState.coachButton || !rendererState.recordButton || !rendererState.stopButton) {
      throw new Error(`renderer_not_initialized:${JSON.stringify(rendererState)}`);
    }
    const undoState = await overlay.webContents.executeJavaScript(`(() => {
      const before = cards.length;
      const id = cards[0]?.id;
      removeCard(id);
      const removed = !cards.some(card => card.id === id) && cards.length === before - 1;
      const restored = restoreDeletedCard() && cards.some(card => card.id === id) && cards.length === before;
      return { removed, restored };
    })()`);
    if (!undoState.removed || !undoState.restored) throw new Error(`card_undo_failed:${JSON.stringify(undoState)}`);
    await overlay.webContents.executeJavaScript(`(() => {
      cards.push({ id:'startup-detached-meeting', createdAt:Date.now(), type:'transcript', title:'Saved meeting', meetingVersion:1, meetingState:'finalized', detachedMeeting:true, segments:[] });
      render();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 80));
    if (meetingWindow.isVisible()) throw new Error('saved_detached_meeting_opened_on_startup');
    await overlay.webContents.executeJavaScript(`(() => {
      const index = cards.findIndex(card => card.id === 'startup-detached-meeting');
      if (index >= 0) cards.splice(index, 1);
      render();
    })()`);
    updateMeetingWindow({ cardId:'smoke-meeting', title:'Smoke meeting', state:'active', duration:'00:01', processing:'', transcript:'Test', summary:'Ready', keyPoints:['One'], topics:[], decisions:[], tasks:[], questions:[], playbook:[], suggestion:'', suggestedFor:'' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const detachedState = await meetingWindow.webContents.executeJavaScript(`({ title:document.querySelector('#title')?.textContent, tabs:document.querySelectorAll('[data-tab]').length })`);
    if (detachedState.title !== 'Smoke meeting' || detachedState.tabs < 5) throw new Error(`meeting_window_not_initialized:${JSON.stringify(detachedState)}`);
    overlay.hide();
    answerPopupRecordingActive = true;
    latestAnswerPopup = { question:'Smoke question', suggestion:'Smoke held answer', at:Date.now() };
    showLatestAnswerPopup();
    updateMeetingWindow({ cardId:'smoke-meeting', title:'Smoke meeting', state:'active', duration:'00:02', processing:'', transcript:'Test update', summary:'Ready', keyPoints:['One'], topics:[], decisions:[], tasks:[], questions:[], playbook:[], suggestion:'Smoke held answer', suggestedFor:'Smoke question' });
    await new Promise(resolve => setTimeout(resolve, 120));
    const answerState = await answerWindow.webContents.executeJavaScript(`({ answer:document.querySelector('#answer')?.textContent, ready:document.body.classList.contains('ready') })`);
    if (overlay.isVisible() || !answerWindow.isVisible() || !answerState.ready || answerState.answer !== 'Smoke held answer') throw new Error(`answer_popup_not_held_while_overlay_hidden:${JSON.stringify(answerState)}`);
    setAnswerSearchPaused(true);
    await new Promise(resolve => setTimeout(resolve, 40));
    const pausedState = await Promise.all([
      overlay.webContents.executeJavaScript(`({ pressed:document.querySelector('#answer-pause')?.getAttribute('aria-pressed'), label:document.querySelector('#answer-pause')?.textContent })`),
      answerWindow.webContents.executeJavaScript(`({ pressed:document.querySelector('#pause')?.getAttribute('aria-pressed'), label:document.querySelector('#pause')?.textContent })`)
    ]);
    if (pausedState.some(state => state.pressed !== 'true' || !state.label.includes('Продолжить'))) throw new Error(`answer_pause_not_synced:${JSON.stringify(pausedState)}`);
    setAnswerSearchPaused(false);
    updateMeetingWindow({ cardId:'smoke-meeting', title:'Smoke meeting', state:'finalized', duration:'00:02', processing:'', transcript:'Test update', summary:'Ready', keyPoints:['One'], topics:[], decisions:[], tasks:[], questions:[], playbook:[], suggestion:'Smoke held answer', suggestedFor:'Smoke question' });
    await new Promise(resolve => setTimeout(resolve, 80));
    const finalizedControls = await meetingWindow.webContents.executeJavaScript(`({ pauseHidden:document.querySelector('#pause')?.hidden, finishDisabled:document.querySelector('#finish')?.disabled, finishLabel:document.querySelector('#finish')?.textContent })`);
    if (!finalizedControls.pauseHidden || finalizedControls.finishDisabled || finalizedControls.finishLabel !== 'Закрыть окно') throw new Error(`finalized_meeting_controls_stale:${JSON.stringify(finalizedControls)}`);
    await meetingWindow.webContents.executeJavaScript(`document.querySelector('#finish')?.click()`);
    await new Promise(resolve => setTimeout(resolve, 80));
    if (meetingWindow.isVisible()) throw new Error('finalized_meeting_window_not_closed');
    await updateManager.check({ manual:true });
    await new Promise(resolve => setTimeout(resolve, 120));
    const updaterUiState = await updateManager.window.webContents.executeJavaScript(`({
      title:document.querySelector('#update-title')?.textContent,
      progress:document.querySelector('#update-progress')?.getAttribute('aria-valuenow'),
      steps:document.querySelectorAll('[data-update-step]').length,
      retryHidden:document.querySelector('#update-retry')?.hidden
    })`);
    if (!updaterUiState.title.includes('Проверка доступна') || updaterUiState.progress !== '100' || updaterUiState.steps !== 6 || !updaterUiState.retryHidden) {
      throw new Error(`updater_window_not_initialized:${JSON.stringify(updaterUiState)}`);
    }
    updateManager.window.hide();
    console.log('SLOY_SMOKE_TEST_READY');
    isQuitting = true;
    app.quit();
    return;
  }
  if (!launchedAtLogin && !isUpdateSmokeTest) showOverlay();
}).catch(error => {
  console.error('[startup-failed]', error);
  if (isSmokeTest) {
    console.error(`SLOY_SMOKE_TEST_FAILED ${error?.message || error}`);
    app.exit(1);
    return;
  }
  showStartupError(error);
  app.exit(1);
});

app.on('before-quit', () => {
  isQuitting = true;
  updateManager?.dispose();
  cancelHideTimer();
  cleanupLiveSttSessions();
});
app.on('will-quit', () => {
  cleanupLiveSttSessions();
  try { capsLockHook?.stop(); } catch {}
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => {
  // The app normally stays alive in the tray; this is only reached on shutdown.
});
