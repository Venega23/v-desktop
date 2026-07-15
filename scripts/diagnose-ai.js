const { app, safeStorage, clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const profile = path.join(process.env.APPDATA || '', 'sloy-memory-overlay');
app.setPath('userData', profile);

const cloudflareAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || 'b19fef9832635eda839f59fc23827e19').trim();
const cloudflareGatewayId = String(process.env.CLOUDFLARE_AI_GATEWAY_ID || 'v-gemini').trim();
const geminiModel = 'gemini-3.1-flash-lite';
const geminiBody = {
  contents:[{ role:'user', parts:[{ text:'Reply with OK only.' }] }],
  generationConfig:{ temperature:0, maxOutputTokens:16 }
};

function readSecretLineFromStdin() {
  process.stdin.setEncoding('utf8');
  return new Promise(resolve => {
    let input = '';
    const onData = chunk => {
      input += chunk;
      const newline = input.search(/[\r\n]/);
      if (newline < 0) return;
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve(input.slice(0, newline).trim());
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

function redact(value) {
  return String(value || '')
    .replace(/xai-[A-Za-z0-9_-]{10,}/g, '<xai-key>')
    .replace(/gsk_[A-Za-z0-9_-]{10,}/g, '<groq-key>')
    .replace(/csk-[A-Za-z0-9_-]{10,}/g, '<cerebras-key>')
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, '<gemini-key>')
    .replace(/AQ\.[A-Za-z0-9_-]{10,}/g, '<gemini-key>')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<secret>')
    .slice(0, 500);
}

function configValue(source, requestedName) {
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

async function probe(label, url, key, body, { headers = null } = {}) {
  if (!key) return { label, configured:false };
  try {
    const response = await fetch(url, {
      method:'POST', signal:AbortSignal.timeout(30000),
      headers:headers || { Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
      body:JSON.stringify(body)
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    const output = payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text
      || payload.choices?.[0]?.message?.content
      || payload.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('') || '';
    const detail = payload.error?.message || payload.error?.code || payload.message || '';
    return { label, configured:true, ok:response.ok, status:response.status, output:Boolean(String(output).trim()), detail:redact(detail) };
  } catch (error) {
    return { label, configured:true, ok:false, status:0, detail:redact(`${error?.name || 'Error'}: ${error?.message || error}`) };
  }
}

app.whenReady().then(async () => {
  const store = JSON.parse(await fs.readFile(path.join(profile, 'secrets.json'), 'utf8'));
  const decrypt = value => {
    try { return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : ''; }
    catch { return ''; }
  };
  const xaiKey = decrypt(store.xaiKey);
  const groqKey = decrypt(store.groqKey || (Array.isArray(store.groqKeys) ? store.groqKeys[0] : ''));
  const cerebrasKey = decrypt(store.cerebrasKey || (Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys[0] : ''));
  const clipboardGeminiKey = process.argv.includes('--gemini-key-clipboard')
    ? (clipboard.readText().match(/(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})/)?.[0] || '')
    : '';
  const geminiKey = clipboardGeminiKey || decrypt(store.geminiKey || (Array.isArray(store.geminiKeys) ? store.geminiKeys[0] : ''));
  const azureKey = decrypt(store.azureSpeechKey);
  const azureRegion = String(store.azureSpeechRegion || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  let bluesmindsKey = '';
  let bluesmindsModel = '';
  try {
    const configPath = String(process.env.SLOY_BLUESMINDS_CONFIG || '').trim();
    const source = configPath ? await fs.readFile(configPath, 'utf8') : '';
    bluesmindsKey = configValue(source, 'GROQ_API_KEY');
    bluesmindsModel = configValue(source, 'GROQ_MODEL');
  } catch {}
  const results = [];
  if (process.argv.includes('--gemini-only')) {
    const clipboardToken = process.argv.includes('--cloudflare-token-clipboard')
      ? (clipboard.readText().match(/cfut_[A-Za-z0-9_-]{20,}/)?.[0] || '')
      : '';
    const cloudflareToken = String(process.env.CLOUDFLARE_AI_GATEWAY_TOKEN || '').trim()
      || clipboardToken
      || (process.argv.includes('--cloudflare-token-stdin') ? await readSecretLineFromStdin() : '');
    results.push({ label:'Gemini stored key', configured:Boolean(geminiKey), recognized:Boolean(/^(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})$/.test(geminiKey)) });
    results.push(await probe('Gemini direct · 3.1 Flash-Lite', `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, geminiKey, geminiBody,
      { headers:{ 'x-goog-api-key':geminiKey, 'Content-Type':'application/json' } }));
    results.push(await probe('Gemini via Cloudflare v-gemini · 3.1 Flash-Lite', `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${cloudflareGatewayId}/google-ai-studio/v1beta/models/${geminiModel}:generateContent`, geminiKey, geminiBody,
      { headers:{ 'x-goog-api-key':geminiKey, ...(cloudflareToken ? { 'cf-aig-authorization':`Bearer ${cloudflareToken}` } : {}), 'Content-Type':'application/json' } }));
    console.log(JSON.stringify(results, null, 2));
    app.quit();
    return;
  }
  const realisticEvidence = (`Етапи роботи із запереченням: 1. Приєднання. 2. Уточнення. 3. Аргумент під потребу. 4. Питання-заклик. Питання-заклик переводить обговорення у конкретний наступний крок і пропонує простий вибір, наприклад: сьогодні чи завтра?\n`).repeat(35).slice(0,7000);
  if (process.argv.includes('--cerebras-only')) {
    results.push(await probe('Cerebras live suggestion', 'https://api.cerebras.ai/v1/chat/completions', cerebrasKey, {
      model:'gpt-oss-120b', temperature:0.25, max_completion_tokens:650, reasoning_effort:'low',
      messages:[
        { role:'system', content:'Ты помощник во время разговора. Дай готовую короткую реплику на русском языке.' },
        { role:'user', content:`Материалы пространства:\n${realisticEvidence}\n\nСобеседник говорит: Мне это слишком дорого.` }
      ]
    }));
    console.log(JSON.stringify(results, null, 2));
    app.quit();
    return;
  }
  if (azureKey && azureRegion) {
    try {
      const response = await fetch(`https://${azureRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method:'POST', signal:AbortSignal.timeout(15000),
        headers:{ 'Ocp-Apim-Subscription-Key':azureKey, 'Content-Length':'0' }
      });
      results.push({ label:'Azure Speech', configured:true, ok:response.ok, status:response.status, region:azureRegion });
    } catch (error) {
      results.push({ label:'Azure Speech', configured:true, ok:false, status:0, region:azureRegion, detail:redact(`${error?.name || 'Error'}: ${error?.message || error}`) });
    }
  } else results.push({ label:'Azure Speech', configured:false });
  results.push({
    label:'stored key formats',
    cerebras:Boolean(/^csk-[A-Za-z0-9_-]{20,}$/.test(cerebrasKey)), cerebrasPool:Array.isArray(store.cerebrasKeys) ? store.cerebrasKeys.length : 0,
    xai:Boolean(/^xai-[A-Za-z0-9_-]{20,}$/.test(xaiKey)),
    groq:Boolean(/^gsk_[A-Za-z0-9_-]{20,}$/.test(groqKey)), groqPool:Array.isArray(store.groqKeys) ? store.groqKeys.length : 0
  });
  results.push(await probe('Cerebras chat', 'https://api.cerebras.ai/v1/chat/completions', cerebrasKey, {
    model:'gpt-oss-120b', temperature:0, max_completion_tokens:32,
    messages:[{ role:'user', content:'Reply with OK only.' }]
  }));
  results.push(await probe('xAI responses', 'https://api.x.ai/v1/responses', xaiKey.match(/xai-[A-Za-z0-9_-]{20,}/)?.[0] || '', {
    model:'grok-4.3', store:false, max_output_tokens:32,
    input:[{ role:'user', content:'Reply with OK only.' }]
  }));
  results.push(await probe('Groq chat', 'https://api.groq.com/openai/v1/chat/completions', groqKey, {
    model:'openai/gpt-oss-120b', temperature:0.2, max_completion_tokens:1600,
    messages:[
      { role:'system', content:'Ты полезный ассистент. Отвечай прямо и содержательно на языке вопроса.' },
      { role:'user', content:`ДОКАЗОВИЙ ПАКЕТ:\n${realisticEvidence}\n\nДля чого в розмові з клієнтом потрібне питання-заклик? Поясни сенс і наведи короткий приклад.` }
    ]
  }));
  results.push(await probe('Gemini direct · 3.1 Flash-Lite', `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, geminiKey, geminiBody,
    { headers:{ 'x-goog-api-key':geminiKey, 'Content-Type':'application/json' } }));
  results.push(await probe('Bluesminds reserve', 'https://api.bluesminds.com/v1/chat/completions', bluesmindsKey && bluesmindsModel ? bluesmindsKey : '', {
    model:bluesmindsModel, temperature:0, max_tokens:32,
    messages:[{ role:'user', content:'Reply with OK only.' }]
  }));
  console.log(JSON.stringify(results, null, 2));
  app.quit();
}).catch(error => {
  console.error(redact(error?.message || error));
  app.exit(1);
});
