const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const profile = path.join(process.env.APPDATA || '', 'sloy-memory-overlay');
app.setPath('userData', profile);

function readSecretLineFromStdin() {
  process.stdin.setEncoding('utf8');
  return new Promise(resolve => {
    let input = '';
    const finish = () => resolve(input.trim());
    process.stdin.on('data', chunk => {
      input += chunk;
      if (/[\r\n]/.test(input)) {
        process.stdin.pause();
        resolve(input.split(/[\r\n]/, 1)[0].trim());
      }
    });
    process.stdin.on('end', finish);
    process.stdin.resume();
  });
}

async function writeSecretStore(store) {
  const filePath = path.join(profile, 'secrets.json');
  const tempPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;
  await fs.mkdir(profile, { recursive:true });
  await fs.copyFile(filePath, `${filePath}.bak`).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await fs.writeFile(tempPath, JSON.stringify(store), { encoding:'utf8', mode:0o600 });
  await fs.rm(filePath, { force:true });
  await fs.rename(tempPath, filePath);
}

app.whenReady().then(async () => {
  const input = String(process.env.CEREBRAS_API_KEY || '').trim() || await readSecretLineFromStdin();
  const key = input.match(/csk-[A-Za-z0-9_-]{20,}/)?.[0] || '';
  if (!key || !safeStorage.isEncryptionAvailable()) throw new Error('invalid_or_unprotected_key');
  const response = await fetch('https://api.cerebras.ai/v1/models', {
    headers:{ Authorization:`Bearer ${key}` }, signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`cerebras_http_${response.status}`);
  let store = {};
  try { store = JSON.parse(await fs.readFile(path.join(profile, 'secrets.json'), 'utf8')); }
  catch {}
  const existing = [store.cerebrasKey, ...(Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys : [])]
    .filter(Boolean)
    .some(value => {
      try { return safeStorage.decryptString(Buffer.from(value, 'base64')) === key; }
      catch { return false; }
    });
  if (!existing) store.cerebrasKeys = [...(Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys : []), safeStorage.encryptString(key).toString('base64')];
  await writeSecretStore(store);
  console.log(JSON.stringify({ ok:true, provider:'cerebras', verified:true, restored:!existing }));
  app.quit();
}).catch(error => {
  console.error(JSON.stringify({ ok:false, reason:String(error?.message || error).slice(0,120) }));
  app.exit(1);
});
