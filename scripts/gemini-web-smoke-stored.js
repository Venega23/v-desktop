const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

app.setPath('userData', path.join(app.getPath('appData'), 'sloy-memory-overlay'));

function decrypt(value) {
  try { return safeStorage.decryptString(Buffer.from(value, 'base64')); }
  catch { return ''; }
}

app.whenReady().then(async () => {
  const store = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'secrets.json'), 'utf8'));
  const encrypted = [store.geminiKey, ...(Array.isArray(store.geminiKeys) ? store.geminiKeys : [])].filter(Boolean);
  const keys = [...new Set(encrypted.map(decrypt).map(value => value.match(/(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})/)?.[0] || '').filter(Boolean))];
  if (!keys.length) throw new Error('stored_gemini_key_missing');
  const baseUrl = String(process.env.SLOY_GEMINI_BASE_URL || 'https://gateway.ai.cloudflare.com/v1/b19fef9832635eda839f59fc23827e19/v-gemini/google-ai-studio/v1beta').replace(/\/+$/, '');
  const failures = [];
  for (const key of keys) {
    const response = await fetch(`${baseUrl}/models/gemini-3.1-flash-lite:generateContent`, {
      method:'POST', signal:AbortSignal.timeout(25000),
      headers:{ 'x-goog-api-key':key, 'Content-Type':'application/json' },
      body:JSON.stringify({
        contents:[{ role:'user', parts:[{ text:'Use Google Search. What is the current latest stable Node.js release line? Answer in one short sentence.' }] }],
        tools:[{ google_search:{} }], generationConfig:{ temperature:0.1, maxOutputTokens:180 }
      })
    });
    if (!response.ok) { failures.push(response.status); continue; }
    const payload = await response.json();
    const text = (payload?.candidates?.[0]?.content?.parts || []).map(part => String(part?.text || '')).join('').trim();
    const metadata = payload?.candidates?.[0]?.groundingMetadata || {};
    const sources = (metadata.groundingChunks || []).filter(chunk => /^https?:\/\//i.test(String(chunk?.web?.uri || '')));
    if (!text) { failures.push('empty'); continue; }
    if (!sources.length && !(metadata.webSearchQueries || []).length) { failures.push('not_grounded'); continue; }
    console.log(`SLOY_GEMINI_WEB_READY sources=${sources.length}`);
    app.exit(0);
    return;
  }
  throw new Error(`gemini_web_failed_${failures.join('_') || 'unknown'}`);
}).catch(error => {
  console.error(error?.message || error);
  app.exit(1);
});
