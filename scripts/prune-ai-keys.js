const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const profile = path.join(process.env.APPDATA || '', 'sloy-memory-overlay');
app.setPath('userData', profile);

async function works(url, options) {
  try {
    const response = await fetch(url, { ...options, signal:AbortSignal.timeout(20000) });
    return response.ok;
  } catch { return false; }
}

app.whenReady().then(async () => {
  const filePath = path.join(profile, 'secrets.json');
  const source = await fs.readFile(filePath, 'utf8');
  const store = JSON.parse(source);
  const decrypt = value => {
    try { return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : ''; }
    catch { return ''; }
  };
  const removed = [];
  const kept = [];

  const azureKey = decrypt(store.azureSpeechKey);
  const azureRegion = String(store.azureSpeechRegion || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const azureWorks = Boolean(azureKey && azureRegion) && await works(`https://${azureRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method:'POST', headers:{ 'Ocp-Apim-Subscription-Key':azureKey, 'Content-Length':'0' }
  });
  if (azureWorks) kept.push('Azure Speech');
  else if (store.azureSpeechKey || store.azureSpeechRegion) {
    delete store.azureSpeechKey;
    delete store.azureSpeechRegion;
    removed.push('Azure Speech');
  }

  const encryptedGroq = [store.groqKey, ...(Array.isArray(store.groqKeys) ? store.groqKeys : [])].filter(Boolean);
  const validGroq = [];
  for (const encrypted of encryptedGroq) {
    const key = decrypt(encrypted).match(/gsk_[A-Za-z0-9_-]{20,}/)?.[0] || '';
    if (!key || validGroq.some(item => item.key === key)) continue;
    const ok = await works('https://api.groq.com/openai/v1/models', { headers:{ Authorization:`Bearer ${key}` } });
    if (ok) validGroq.push({ key, encrypted });
  }
  if (validGroq.length) {
    store.groqKey = validGroq[0].encrypted;
    if (validGroq.length > 1) store.groqKeys = validGroq.slice(1).map(item => item.encrypted);
    else delete store.groqKeys;
    kept.push(`Groq (${validGroq.length})`);
  } else if (encryptedGroq.length) {
    delete store.groqKey;
    delete store.groqKeys;
    removed.push('Groq');
  }

  const xaiKey = decrypt(store.xaiKey).match(/xai-[A-Za-z0-9_-]{20,}/)?.[0] || '';
  const xaiWorks = Boolean(xaiKey) && await works('https://api.x.ai/v1/models', { headers:{ Authorization:`Bearer ${xaiKey}` } });
  if (xaiWorks) kept.push('xAI');
  else if (store.xaiKey) {
    delete store.xaiKey;
    removed.push('xAI');
  }

  const backupPath = `${filePath}.before-prune-${Date.now()}.bak`;
  await fs.writeFile(backupPath, source, { encoding:'utf8', mode:0o600 });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store), { encoding:'utf8', mode:0o600 });
  await fs.rm(filePath, { force:true });
  await fs.rename(tempPath, filePath);
  console.log(JSON.stringify({ kept, removed, backup:path.basename(backupPath) }, null, 2));
  app.quit();
}).catch(error => {
  console.error(error?.message || error);
  app.exit(1);
});
