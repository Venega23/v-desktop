const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

app.setPath('userData', path.join(app.getPath('appData'), 'sloy-memory-overlay'));

function decrypt(value) {
  try { return safeStorage.decryptString(Buffer.from(value, 'base64')); }
  catch { return ''; }
}

app.whenReady().then(async () => {
  const store = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'secrets.json'), 'utf8'));
  const encrypted = [store.cerebrasKey, ...(Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys : [])].filter(Boolean);
  const key = encrypted.map(decrypt).map(value => value.match(/csk-[A-Za-z0-9_-]{20,}/)?.[0] || '').find(Boolean);
  if (!key) throw new Error('stored_cerebras_key_missing');

  const cwd = path.join(__dirname, '..');
  const child = spawn(process.execPath, ['.', '--ai-smoke-test'], {
    cwd,
    env:{ ...process.env, CEREBRAS_API_KEY:key },
    stdio:['ignore', 'pipe', 'pipe'],
    windowsHide:true
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on('exit', code => { app.exit(Number(code) || 0); });
}).catch(error => {
  console.error(error?.message || error);
  app.exit(1);
});
