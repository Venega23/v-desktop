const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const meetingHtml = fs.readFileSync(path.join(root, 'meeting.html'), 'utf8');
const meetingScript = fs.readFileSync(path.join(root, 'meeting.js'), 'utf8');
const answerHtml = fs.readFileSync(path.join(root, 'answer.html'), 'utf8');
const launcher = fs.readFileSync(path.join(root, 'Запустить Слой.cmd'), 'utf8');
const antischoolSource = fs.readFileSync(path.join(root, 'antischool-content.js'), 'utf8');
const diagnoseAi = fs.readFileSync(path.join(root, 'scripts', 'diagnose-ai.js'), 'utf8');

const antischoolContext = { window:{} };
vm.runInNewContext(antischoolSource, antischoolContext);
assert.equal(antischoolContext.window.ANTISCHOOL_CONTENT.length, 20, 'The Antischool board must contain all 20 supplied cards');
assert.equal(new Set(antischoolContext.window.ANTISCHOOL_CONTENT.map(card => card.id)).size, 20, 'Every Antischool card must have a stable unique id');
assert.match(html, /antischool-content\.js[\s\S]{0,100}app\.js/, 'Antischool content must load before the board renderer');
assert.match(app, /migrateAntischoolBoardV3[\s\S]{0,1000}card\.type === 'transcript'/, 'Replacing the Antischool board must preserve meeting recordings');
assert.match(app, /source:'antischool-board'/, 'The Antischool source material must also be imported into the knowledge hub');

assert.match(html, /id="record-stop"/, 'A visible stop control must exist');
assert.match(html, /id="coach-button"[\s\S]{0,120}AI-помощник/, 'The sidebar must expose a separate realtime assistant mode');
assert.match(app, /let recordingStarting = false/, 'Async start must have a re-entry guard');
assert.match(app, /if \(session\.stopRequested \|\| recordingSession !== session\)/, 'Late live-STT continuation must not revive a stopped session');
assert.match(app, /createRecordingCard\(session\);[\s\S]{0,300}record-stop/, 'Stop must create a workspace placeholder before network work');
assert.match(app, /session\.sourceRecordings\.forEach[\s\S]{0,350}catch \{ entry\.finish\(\); \}/, 'Every source recorder must stop independently');
assert.match(app, /void processMeetingSegmentWithAi/, 'Meeting segment AI processing must run after local save without blocking pause UI');
assert.match(app, /activeMeetingId/, 'A workspace must keep one resumable active meeting');
assert.match(app, /meetingState = 'paused'/, 'Stopping capture must pause the meeting instead of creating a new hub');
assert.match(meetingHtml, /id="finish">Завершить встречу/, 'The detached meeting window must expose an explicit finish control while recording');
assert.match(meetingScript, /finalized \? 'Закрыть окно'/, 'A finalized meeting must replace its stale finish label with a close action');
assert.match(meetingScript, /meeting\.state === 'finalized'[\s\S]{0,160}sendMeetingWindowAction\?\.\('hide'/, 'The finalized meeting action must actually hide the detached window');
assert.match(app, /aggregateMeetingTranscript/, 'Meeting transcript must accumulate across recording segments');
assert.match(html, /id="record-finish"/, 'Finishing a meeting must be separate from pausing a segment');
assert.match(app, /data-meeting-tab/, 'A meeting hub must expose focused tabs instead of one long card');
assert.match(app, /recordingSession\.finalizeAfterSave/, 'Explicit finish must finalize only after the current segment is saved');
assert.match(app, /spaceId:recordingSpaceId/, 'Recording session must snapshot its source workspace');
assert.match(app, /captureSystemAudio:false/, 'Microphone-only capture should be the safe default to avoid duplicate speaker audio');
assert.match(html, /id="record-source-system"[^>]*aria-pressed="false"/, 'The active recording panel must expose the computer-audio toggle state');
assert.match(app, /systemStream, systemAudioEnabled:/, 'The current recording session must retain its optional system stream for live toggling');
assert.match(css, /\.record-panel\s*\{\s*position: fixed; z-index: 96/, 'Recording controls must stay above the selection toolbar');
assert.match(css, /\.recording-active \.selection-bar \{ display:none !important; \}/, 'Selection UI must not intercept the stop button');
assert.match(main, /audio\.done/, 'Streaming STT must explicitly finalize audio');
assert.match(main, /groq:transcribe-chunk/, 'Groq keys must provide near-live chunk transcription');
assert.match(app, /startGroqLiveTranscription/, 'Renderer must start the Groq live transcription path');
assert.match(app, /updateLiveOutline/, 'Live transcript must feed the on-screen outline');
assert.match(app, /Расшифровать и сделать конспект/, 'Saved recordings must support retrying AI processing');
assert.match(app, /transcriptionLanguage:'uk'/, 'Speech language must default to an explicit Ukrainian locale');
assert.doesNotMatch(html, /option value="auto"/, 'Language selection must not silently fall back to mixed automatic detection');
assert.match(html, /<option value="uk">Українська<\/option><option value="ru">Русский<\/option><option value="en">English<\/option>/, 'Language selector must offer explicit Ukrainian, Russian, and English modes');
assert.match(app, /class="meeting-language"/, 'Each meeting hub must expose its locked recognition language');
assert.match(app, /function rebuildMeetingSummary/, 'Existing summaries must be regeneratable in the selected language');
assert.match(app, /migrateOrphanAiCardsIntoKnowledge/, 'Legacy AI helper cards must be removed from the board without losing their content');
assert.match(css, /body\.light-theme \{\s*--ink:#25303b;\s*--muted:#657382;/, 'Light theme must redefine shared foreground variables for every new component');
assert.match(main, /\['ru','uk','en'\]/, 'Backend must accept Russian, Ukrainian, and English language hints');
assert.match(main, /microsoft-cognitiveservices-speech-sdk/, 'Azure Speech SDK must provide true streaming transcription');
assert.match(main, /azure:stream:start/, 'Azure Speech must expose a live stream entry point');
assert.match(main, /ConversationTranscriber/, 'Azure system audio must support multiple remote speaker labels');
assert.match(main, /azure_start_timeout/, 'Azure startup must be bounded by a timeout');
assert.match(main, /azure_stop_timeout/, 'Azure shutdown must not block local audio saving');
assert.match(main, /azureSpeechKey/, 'Azure Speech key must be stored through the protected secret store');
assert.match(app, /status\.providers\?\.azure/, 'Renderer must prefer Azure for live transcription when configured');
assert.match(app, /status\.providers\?\.xai[\s\S]{0,1600}status\.providers\?\.groq/, 'Speech provider selection must ignore answer-only Cerebras and Gemini keys and fall back from xAI to Groq');
assert.match(html, /id="azure-speech-key"/, 'AI settings must include a protected Azure Speech key field');
assert.match(html, /id="knowledge-dialog"/, 'Each workspace must expose a compact knowledge hub');
assert.match(html, /id="knowledge-image-input"/, 'Knowledge hub must accept image files');
assert.match(html, /id="space-chat-feed"[\s\S]{0,1200}id="space-chat-input"[\s\S]{0,500}id="space-chat-send"/, 'Each workspace must expose a persistent chat interface');
assert.match(html, /data-space-prompt="[^"]*Создай карточки из всей информации пространства/, 'Workspace chat must expose an explicit all-information card command');
assert.match(app, /function workspaceKnowledge/, 'Knowledge must be scoped to the active workspace');
assert.match(app, /function workspaceContextEntries[\s\S]{0,2600}knowledge\.items[\s\S]{0,2600}space\.cards/, 'Workspace chat context must combine hub materials with every board card');
assert.match(app, /function rankWorkspaceEntries[\s\S]{0,2600}wantsSpokenReply[\s\S]{0,2600}score/, 'Workspace chat must rank conversational situations before calling an AI provider');
assert.match(app, /function buildSpaceChatContext[\s\S]{0,2200}120000[\s\S]{0,2200}РЕЛЕВАНТНЫЕ МАТЕРИАЛЫ/, 'Workspace chat must send a compact relevance-ranked packet instead of the entire board');
assert.match(app, /function localSpaceChatAnswer[\s\S]{0,2600}локальный синтез/, 'Relevant workspace material must remain usable as a synthesized answer when every AI provider is unavailable');
assert.doesNotMatch(app, /У матеріалах є готова відповідь|В материалах есть готовый ответ/, 'Workspace fallback must never expose a raw top-card dump as an assistant answer');
assert.match(app, /function inferSpaceChatIntent[\s\S]{0,1200}(?:приклад|пример)[\s\S]{0,300}dialogue/, 'Workspace chat must classify example-dialogue requests explicitly');
assert.match(main, /Материалы — это доказательства и строительные блоки[\s\S]{0,1000}Не копируй один источник целиком/, 'Workspace generation must synthesize from evidence instead of imitating card lookup');
assert.match(main, /function isWeakGeneratedSpaceAnswer[\s\S]{0,4000}turns\.length < 6/, 'Weak, short, or non-alternating dialogue answers must be detected structurally');
assert.match(main, /КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ/, 'Weak workspace answers must receive a corrective generation attempt');
assert.match(main, /if \(jsonSchema\)[\s\S]{0,240}parseJsonText\(text\)[\s\S]{0,260}invalid_json/, 'Malformed structured output must fall through to another AI provider');
assert.match(main, /excludeProviders[\s\S]{0,1200}excludedProviders[\s\S]{0,500}alternatives/, 'Semantic repair must be able to skip the provider that returned a weak answer');
assert.match(main, /parsedAnswer = value => \{[\s\S]{0,500}value\?\.answer \?\? value\?\.content[\s\S]{0,900}value\?\.dialogue/, 'Workspace chat must normalize common non-strict JSON answer aliases and dialogue arrays from fallback providers');
assert.match(app, /function publishSpaceChatCards[\s\S]{0,1200}space\.cards\.unshift/, 'Workspace chat must be able to publish generated cards onto the current board');
assert.match(app, /analyzeKnowledgeImage/, 'Pasted images must be analyzed instead of becoming unstructured clutter');
assert.match(app, /ДОКАЗОВИЙ ПАКЕТ ІЗ БАЗИ ЗНАНЬ/, 'Live AI context must include the current workspace knowledge base');
assert.match(main, /knowledge:analyze-image/, 'Main process must provide protected vision analysis');
assert.match(main, /qwen\/qwen3\.6-27b/, 'Knowledge vision must use a currently supported multimodal model');
assert.match(html, /value="uk">Українська/, 'Language selector must expose Ukrainian');
assert.match(main, /extractGroqKey/, 'Stored provider values must be parsed as strict API keys');
assert.match(main, /invalidStoredKey/, 'Invalid encrypted values must be reported to the UI');
assert.match(app, /await context\.resume\(\)/, 'Live audio contexts must be resumed before capturing PCM');
assert.match(app, /createRecordingCard\(session\);/, 'A workspace recording card must be created as soon as capture starts');
assert.match(main, /execFileAsync\('ffmpeg'/, 'WebM recordings must be remuxed to receive duration metadata');
assert.match(app, /const occupied = cards\.filter/, 'New cards must be placed against all already occupied rectangles');
assert.match(app, /maybeStructureLiveConversation/, 'Long conversations must be periodically summarized during recording');
assert.match(app, /transcript-details/, 'Full transcripts must be collapsed behind a disclosure control');
assert.match(html, /id="rich-text-toolbar"/, 'Selected text must expose a formatting toolbar');
assert.match(html, /id="space-chat-scale-down"[\s\S]{0,400}id="space-chat-scale-value"[\s\S]{0,400}id="space-chat-scale-up"/, 'Workspace chat must expose accessible text-scale controls');
assert.match(html, /id="space-chat-verbosity"[\s\S]{0,300}value="short"[\s\S]{0,300}value="balanced"[\s\S]{0,300}value="detailed"/, 'Workspace chat must expose persistent answer-length choices');
assert.match(html, /id="space-chat-feed"[^>]*role="log"[^>]*aria-live="polite"/, 'New workspace-chat answers must be announced without interrupting the user');
assert.match(css, /\.space-chat-panel\s*\{[^}]*--chat-text-scale:\s*1/, 'Chat text scaling must use a scoped CSS variable instead of zooming the whole application');
assert.match(css, /\.space-chat-message-text[^}]*user-select:\s*text/, 'Chat answer text must remain selectable for copying and formatting');
assert.match(app, /spaceChatPanel\?\.addEventListener\('wheel'[\s\S]{0,700}event\.preventDefault\(\)[\s\S]{0,700}passive:false/, 'Ctrl+wheel must change only chat text scale and suppress Electron page zoom');
assert.match(app, /knowledgeDialog\.appendChild\(richTextToolbar\)/, 'The chat formatting toolbar must join the modal top layer before it becomes interactive');
assert.match(app, /knowledge\.chat\.filter\(item => !\['preference','preference_ack'\]\.includes\(item\.kind\)\)/, 'Preference-only commands must never pollute model conversation history');
assert.match(main, /const safePreferences = \{[\s\S]{0,500}\['short','balanced','detailed'\]/, 'Answer preferences must be validated separately from workspace evidence');
assert.match(main, /ПРЕДПОЧТЕНИЯ ОТВЕТА: \$\{verbosityRule\} \$\{formatRule\}/, 'Validated answer preferences must become trusted model instructions');
assert.match(css, /recording-active \.live-outline-panel/, 'Floating live panels must not duplicate workspace cards during recording');

const chatFormatStart = app.indexOf('const CHAT_FORMAT_FONTS');
const chatFormatEnd = app.indexOf('function normalizeWorkspaces', chatFormatStart);
const chatFormatContext = {
  escapeHtml:value => String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
};
vm.runInNewContext(`${app.slice(chatFormatStart, chatFormatEnd)}; this.normalizePreferences=normalizeSpaceChatPreferences; this.normalizeFormats=normalizeChatFormats; this.applyRanges=applyChatFormatRanges; this.toggle=toggleChatFormatRangeProperty; this.markup=chatFormattedTextMarkup;`, chatFormatContext);
assert.equal(chatFormatContext.normalizePreferences({ textScale:'broken' }).textScale, 100, 'Corrupt saved scale values must recover to 100%');
assert.equal(chatFormatContext.normalizePreferences({ textScale:17 }).textScale, 80, 'Chat scale must remain readable at its lower boundary');
assert.equal(chatFormatContext.normalizePreferences({ textScale:999 }).textScale, 200, 'Chat scale must stay inside its upper boundary');
assert.equal(chatFormatContext.normalizePreferences({ verbosity:'anything' }).verbosity, 'balanced', 'Unknown verbosity values must not enter the trusted preference payload');
const safeRanges = chatFormatContext.applyRanges([], 11, 0, 5, { bold:true, font:'georgia', color:'#12ABef' });
assert.match(chatFormatContext.markup({ text:'Hello world', formats:safeRanges }), /class="chat-format-bold chat-format-font-georgia" style="color:#12abef">Hello<\/span> world/, 'A safe range must render formatting without changing message text');
const clearedRanges = chatFormatContext.applyRanges(safeRanges, 11, 2, 4, null);
assert.equal(JSON.stringify(clearedRanges), JSON.stringify([{ start:0, end:2, style:{ bold:true, font:'georgia', color:'#12abef' } }, { start:4, end:5, style:{ bold:true, font:'georgia', color:'#12abef' } }]), 'Clearing a subrange must preserve formatting on both sides');
assert.equal(chatFormatContext.normalizeFormats([{ start:0, end:5, style:{ font:'url(javascript:1)', color:'red' } }], 5).length, 0, 'Untrusted fonts and CSS colors must be discarded');
assert.doesNotMatch(chatFormatContext.markup({ text:'<img src=x onerror=alert(1)>', formats:[] }), /<img/i, 'Chat message rendering must escape stored text instead of trusting HTML');
const toggledOff = chatFormatContext.toggle([{ start:0, end:5, style:{ bold:true, color:'#123456' } }], 5, 0, 5, 'bold');
assert.equal(JSON.stringify(toggledOff), JSON.stringify([{ start:0, end:5, style:{ color:'#123456' } }]), 'Pressing a format button again must remove only that property');

const chatPreferenceStart = app.indexOf('function parseSpaceChatPreferenceCommand');
const chatPreferenceEnd = app.indexOf('function workspaceRelevantExcerpt', chatPreferenceStart);
const chatPreferenceContext = {};
vm.runInNewContext(`${app.slice(chatPreferenceStart, chatPreferenceEnd)}; this.parse=parseSpaceChatPreferenceCommand;`, chatPreferenceContext);
assert.equal(JSON.stringify(chatPreferenceContext.parse('Отвечай покороче если что')), JSON.stringify({ kind:'pure', patch:{ verbosity:'short' }, turnPatch:{}, taskText:'' }), 'A natural brevity command must be stored locally without calling the model');
assert.equal(chatPreferenceContext.parse('Отвечай короче и расскажи про цену').taskText, 'расскажи про цену', 'A mixed preference and question must send only the semantic task to retrieval and AI');
assert.equal(chatPreferenceContext.parse('Коротко: объясни цену').kind, 'turn', 'One-turn brevity wording must not overwrite the persistent preference');
assert.equal(chatPreferenceContext.parse('Что значит отвечай короче?').kind, 'none', 'Discussing a preference phrase must not accidentally change settings');
assert.equal(chatPreferenceContext.parse('Відповідай коротше').patch.verbosity, 'short', 'Natural Ukrainian brevity commands must be supported');
assert.equal(chatPreferenceContext.parse('Отвечай короче и дай цену').taskText, 'дай цену', 'Short mixed commands must not discard a task introduced with «дай»');
assert.equal(chatPreferenceContext.parse('Отвечай короче, объясни цену').taskText, 'объясни цену', 'A comma must be accepted as the boundary between a preference and a task');
assert.equal(chatPreferenceContext.parse('Пиши рассказ короче предыдущего').kind, 'none', 'Ordinary writing requests containing «короче» must not become preference commands');
assert.equal(chatPreferenceContext.parse('Переведи фразу сбрось настройки').kind, 'none', 'Mentioning a reset phrase inside another task must not reset chat settings');
assert.equal(chatPreferenceContext.parse('Отвечай короче и сделай пример диалога').taskText, 'сделай пример диалога', 'Mixed preference commands must preserve tasks beyond a fixed verb allowlist');
assert.equal(chatPreferenceContext.parse('Отвечай короче, но объясни цену').taskText, 'объясни цену', 'Contrast conjunctions must separate a preference from its real task');
assert.equal(JSON.stringify(chatPreferenceContext.parse('Отвечай короче и без списков').patch), JSON.stringify({ verbosity:'short', format:'paragraphs' }), 'One command may update several compatible answer preferences');

const spaceChatLogicStart = app.indexOf('function workspaceCardText');
const spaceChatLogicEnd = app.indexOf('function importMeetingToKnowledge', spaceChatLogicStart);
const spaceChatContext = {
  htmlToWorkspaceText:value => String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
  workspaceKnowledge:space => space.knowledge,
  activeSpace:() => null,
  dedupeStrings:values => [...new Set(values)],
  normalizeSpaceChatPreferences:value => ({ verbosity:['short','detailed'].includes(value?.verbosity) ? value.verbosity : 'balanced', format:['paragraphs','bullets'].includes(value?.format) ? value.format : 'auto', language:'auto', textScale:100 })
};
vm.runInNewContext(`${app.slice(spaceChatLogicStart, spaceChatLogicEnd)}; this.intent=inferSpaceChatIntent; this.resolveIntent=resolveSpaceChatIntent; this.rank=rankWorkspaceEntries; this.answer=localSpaceChatAnswer; this.packet=buildSpaceChatContext;`, spaceChatContext);
const dialogueFixture = {
  title:'Антишкола', knowledge:{ items:[], facts:[], tags:[], playbook:[], summary:'' }, cards:[
    { id:'algorithm', kicker:'01 · Алгоритм', title:'4 кроки', knowledgeText:'Приєднання: «Розумію вас»\nУточнення: «Що саме вас бентежить?»\nАргумент: відповідь під потребу\nЗаклик: «Сьогодні чи завтра?»' },
    { id:'not-interested', kicker:'02 · Заперечення', title:'«Не цікаво / Не актуально»', knowledgeText:'Це хибне заперечення.\nУточнення: «Підкажіть, уже займаєтесь десь? Чи просто немає часу?»' },
    { id:'already', kicker:'03 · Заперечення', title:'«Вже займаюся»', knowledgeText:'Приєднання: «Дуже круто, що розвиваєте англійську!»\nУточнення: «В якому форматі? Чого не вистачає? Яка мета?»\nАргумент: «Студент говорить 50–70% уроку».\nЗаклик: «На який день зручніше — сьогодні чи завтра?»' },
    { id:'dialogue', kicker:'20 · Приклад', title:'Повний діалог · приклад', knowledgeText:'Т — менеджер, К — клієнт\nК: «Не актуально».\nТ: «Розумію. Уже займаєтесь десь або просто немає часу?»\nК: «Займаюсь, але мало розмовної практики».\nТ: «Дуже круто! В якому форматі займаєтесь?»\nК: «У групі».\nТ: «Чого бракує і якої мети хочете досягти?»\nК: «Хочу вільно говорити».\nТ: «У нас студент говорить 50–70% уроку».\nТ: «Спробуєте пробний сьогодні чи завтра?»' },
    { id:'price', kicker:'05 · Заперечення', title:'«Дорого»', knowledgeText:'Приєднання: «Фінансове питання важливе».\nУточнення: «З чим порівнюєте?»\nАргумент: «299 гривень за урок, студент говорить 50–70% часу».\nЗаклик: «Порівняємо наповнення?»' }
  ]
};
const screenshotQuery = 'не цікаво НЕАКТУАЛЬНО. Приклад діалога';
assert.equal(spaceChatContext.intent(screenshotQuery), 'dialogue', 'The exact reported mixed-language request must be understood as dialogue generation');
assert.match(spaceChatContext.rank(dialogueFixture, screenshotQuery)[0].title, /діалог/i, 'Dialogue evidence must outrank a literal objection-title match for a dialogue task');
const offlineDialogue = spaceChatContext.answer(dialogueFixture, screenshotQuery)?.text || '';
assert.ok((offlineDialogue.match(/(?:^|\n)\s*(?:Т|М|К):/g) || []).length >= 6, 'Offline fallback must return a multi-turn dialogue');
assert.doesNotMatch(offlineDialogue, /готова відповідь|02 · Заперечення|РЕЛЕВАНТНЫЕ МАТЕРИАЛЫ/i, 'Offline fallback must not leak a card title or retrieval packet');
const offlineRoles = [...offlineDialogue.matchAll(/(?:^|\n)\s*([ТМК]):/g)].map(match => match[1] === 'К' ? 'client' : 'manager');
assert.ok(offlineRoles.every((role, index) => index === 0 || role !== offlineRoles[index - 1]), 'Offline dialogue roles must alternate naturally');
assert.notEqual(offlineDialogue.includes(dialogueFixture.cards.find(card => card.id === 'dialogue').knowledgeText), true, 'Offline dialogue must be newly assembled instead of copying the full-dialogue card');
assert.match(spaceChatContext.packet(dialogueFixture, screenshotQuery), /Тип задачи: dialogue[\s\S]*Повний діалог[\s\S]*(?:4 кроки|Не цікаво)/, 'AI context must combine dialogue evidence with supporting scenario material');
assert.equal(spaceChatContext.intent('Покажи пример разговора целиком'), 'dialogue', 'Russian paraphrases must resolve to the same dialogue intent');
assert.equal(spaceChatContext.intent('Зроби діалог про заперечення'), 'dialogue', 'Natural Ukrainian dialogue commands must be recognized');
assert.equal(spaceChatContext.intent('Сделай диалог о цене'), 'dialogue', 'Natural Russian dialogue commands must be recognized');
assert.equal(spaceChatContext.intent('Клієнт каже, що це дорого'), 'draft_response', 'A reported client objection must request a ready response');
assert.equal(spaceChatContext.resolveIntent('Какая цена?', 'Покажи пример диалога'), 'answer', 'A new factual question must replace the prior dialogue intent');
assert.equal(spaceChatContext.resolveIntent('А теперь целиком', 'Покажи пример диалога'), 'dialogue', 'An explicitly dependent follow-up must inherit the prior dialogue intent');
assert.match(spaceChatContext.rank(dialogueFixture, 'Сделай диалог о цене', 'dialogue')[0].title, /Дорого/, 'Dialogue-format evidence must not outrank a different requested topic');
assert.match(spaceChatContext.rank(dialogueFixture, 'Зроби діалог про ціну', 'dialogue')[0].title, /Дорого/, 'A same-language full-dialogue card must not outrank the requested topic');
assert.doesNotMatch(spaceChatContext.answer(dialogueFixture, 'Сделай диалог о цене', 'dialogue')?.text || '', /Вот цельный|Например|Понятно/, 'Offline dialogue framing must stay in the language of the retrieved source phrases');
assert.match(spaceChatContext.answer(dialogueFixture, 'Сколько стоит урок?')?.text || '', /299[\s\S]*50–70%/, 'Offline synthesis must preserve leading numbers and percentages');
assert.equal(spaceChatContext.answer(dialogueFixture, 'Кто директор компании?'), null, 'Unknown factual questions must not fall back to an arbitrary card');
assert.equal(spaceChatContext.answer(dialogueFixture, 'Кто автор 4 кроки?'), null, 'Partial title overlap must not fabricate an unknown author from unrelated card content');

const mainSpaceChatLogicStart = main.indexOf('  function inferSpaceChatTask');
const mainSpaceChatLogicEnd = main.indexOf("  handleTrusted('space:chat'", mainSpaceChatLogicStart);
const mainSpaceChatContext = {};
vm.runInNewContext(`${main.slice(mainSpaceChatLogicStart, mainSpaceChatLogicEnd)}; this.intent=inferSpaceChatTask; this.weak=isWeakGeneratedSpaceAnswer;`, mainSpaceChatContext);
assert.equal(mainSpaceChatContext.intent('Какая цена?', [{ role:'user', text:'Создай карточки по теме' }]), 'answer', 'Backend must never inherit a mutating card-creation intent into a new question');
assert.equal(mainSpaceChatContext.intent('Какая цена?', [{ role:'user', text:'Покажи пример диалога' }]), 'answer', 'Backend must classify a complete new question independently from history');
assert.equal(mainSpaceChatContext.intent('А теперь целиком', [{ role:'user', text:'Покажи пример диалога' }]), 'dialogue', 'Backend may inherit intent only for an explicitly dependent follow-up');
assert.equal(mainSpaceChatContext.intent('А теперь целиком', [{ role:'user', text:'Покажи пример диалога' }, { role:'user', text:'Какая цена?' }]), 'answer', 'A dependent follow-up must inherit only the immediately previous user topic');
assert.equal(mainSpaceChatContext.weak('В материалах недостаточно информации, чтобы назвать директора.', 'answer', ''), false, 'An honest unknown-fact answer must not be repaired into a hallucination');
assert.equal(mainSpaceChatContext.weak('М: Один\nК: Два\nМ: Три\nК: Четыре\nМ: Пять', 'dialogue', ''), true, 'A five-turn dialogue must fail the quality gate');
assert.equal(mainSpaceChatContext.weak('М: Один\nК: Два\nМ: Три\nК: Четыре\nМ: Пять\nК: Шесть', 'dialogue', ''), false, 'A six-turn alternating dialogue must pass the structural quality gate');
assert.equal(mainSpaceChatContext.weak('М: Один\nМ: Два\nК: Три\nМ: Четыре\nК: Пять\nМ: Шесть', 'dialogue', ''), true, 'Repeated speaker roles must fail the structural quality gate');
assert.equal(mainSpaceChatContext.weak('М: Мене звати Олена\nК: Два\nМ: Три\nК: Чотири\nМ: П’ять\nК: +380 67 123 4567', 'dialogue', ''), true, 'Dialogue validation must reject invented personal data');
assert.equal(mainSpaceChatContext.weak('Карточка «02 · Возражение»: Приєднання, уточнення, аргумент і заклик.', 'answer', ''), true, 'Provider answers must not leak a raw card label in alternative punctuation');
assert.match(app, /function appendLiveUtterance/, 'Mic and system transcripts must be deduplicated before entering the conversation');
assert.match(app, /function sanitizeRecap/, 'Summary sections must remove duplicate points and questions');
assert.match(css, /source-tracks label span \{ color:#526171/, 'Audio source labels must remain readable in the light theme');
assert.match(app, /function looksLikeAddressedQuestion/, 'AI suggestions must be gated behind a direct-question detector');
assert.match(app, /recordingSession\.card\.suggestedAnswer = suggestion/, 'Live answers must stay inside the conversation hub');
assert.doesNotMatch(app, /function ensureLiveAuxCard/, 'Recording must not create automatic auxiliary cards');
assert.match(app, /class="pin-suggestion"/, 'A standalone cheat card must require an explicit pin action');
assert.match(app, /consolidateGeneratedMeetingCards/, 'Prototype-era AI cards must be consolidated into their conversation hub');
assert.match(app, /structuredSource === 'ai'/, 'A richer live AI recap must not be overwritten by a local fallback recap');
assert.match(app, /pendingSuggestionQuestion/, 'The latest direct question must survive while another suggestion is in flight');
assert.match(app, /function mergeSuggestionRequests[\s\S]{0,1200}question\.slice\(-2000\)/, 'Consecutive speech-final fragments must be merged into one complete assistant turn');
assert.match(app, /coachOnly \? 1800 : 1300/, 'Voice turns must wait for a short pause instead of firing on every recognition fragment');
assert.match(app, /\$\{SPACES_KEY\}\.recovery\.\$\{Date\.now\(\)\}/, 'Corrupted workspace storage must be copied to a distinct recovery key');
assert.match(app, /spacesStorageWritesBlocked = !recovered/, 'The original corrupted payload must remain protected when recovery cannot be written');
assert.match(app, /const saved = persistWorkspaces\(\);[\s\S]{0,100}if \(saved && message\) showToast\(message\)/, 'Save success messages must only appear after persistence succeeds');
assert.match(app, /window\.addEventListener\('blur',[\s\S]{0,160}flushDebouncedSave\(\)/, 'Pending edits must flush when the window loses focus');
assert.match(app, /window\.addEventListener\('beforeunload', \(\) => flushDebouncedSave\(''\)\)/, 'Pending edits must flush before the renderer unloads');
assert.match(html, /id="link-dialog"[\s\S]{0,800}id="link-url"/, 'Link creation and editing must use a dedicated dialog');
assert.doesNotMatch(app, /https:\/\/example\.com/, 'Adding a link must not persist a live example.com placeholder');
assert.match(app, /class="link-settings"/, 'Existing link cards must expose editing in edit mode');
assert.match(app, /class="checklist-add"/, 'Checklist rows must be addable in edit mode');
assert.match(app, /class="checklist-remove"/, 'Checklist rows must be removable in edit mode');
assert.match(app, /segmentOffsetSeconds[\s\S]{0,180}globalOffsetSeconds/, 'Recorded highlights must persist segment-relative and meeting-global offsets');
assert.match(app, /function meetingHighlightEntries/, 'Meeting hubs must normalize new and legacy highlights');
assert.match(app, /class="meeting-highlight"/, 'Meeting hubs must render marked moments with context');
assert.match(app, /function seekMeetingHighlight/, 'Marked moments should seek their corresponding segment audio');
assert.match(html, /id="recording-preflight-dialog"[\s\S]{0,1400}id="recording-participant-consent"/, 'First recording must explain sources and require participant consent before media access');
assert.match(app, /recordingStarting = true;[\s\S]{0,180}if \(!await ensureRecordingPreflight\(\)\)[\s\S]{0,1800}getUserMedia/, 'Recording preflight must complete under the start mutex before the browser asks for microphone permission');
assert.match(app, /card\.meetingVersion && card\.segments\?\.length[\s\S]{0,900}processMeetingSegmentWithAi/, 'Meeting retry must process a segment without replacing the aggregate transcript');
assert.match(app, /card\.transcript = aggregateMeetingTranscript\(card\)/, 'Meeting retry must rebuild its transcript from all saved segments');
assert.match(app, /function clearRememberedTextSelection/, 'Collapsed or outside selections must clear the rich text toolbar state');
assert.match(html, /data-layout="dashboard"[\s\S]{0,500}data-layout="gallery"[\s\S]{0,500}data-layout="list"/, 'Dashboard, gallery, and list controls must all be visible');
assert.match(html, /id="sort-cards"[\s\S]{0,500}value="manual"[\s\S]{0,500}value="newest"[\s\S]{0,500}value="title"[\s\S]{0,500}value="number"/, 'Flow layouts must expose manual, newest, title, and number sorting');
assert.match(html, /id="sort-number-button"/, 'The sidebar must expose one-click numeric card sorting');
assert.match(app, /if \(layout === 'dashboard'\) view\.sort = 'manual'/, 'Dashboard mode must always use manual freeform order');
assert.match(app, /if \(dashboard\) \{[\s\S]{0,500}card\.position\.x/, 'Saved freeform coordinates must only be applied on the dashboard');
assert.match(app, /if \(activeSpace\(\)\.view\.layout === 'dashboard'\)[\s\S]{0,180}bindDirectDrag\(el, id\)[\s\S]{0,100}if \(editMode\) bindLiveResize\(el, id\)/, 'Dashboard cards must move in both modes and additionally resize in edit mode');
assert.match(app, /else \{[\s\S]{0,100}bindFlowFreeDrag\(el, id\)[\s\S]{0,100}if \(editMode\) bindFlowResize\(el, id\)/, 'Gallery and list cards must move in both modes and additionally resize in edit mode');
const flowDragSource = app.slice(app.indexOf('function bindFlowFreeDrag'), app.indexOf('function bindFlowResize'));
const directDragSource = app.slice(app.indexOf('function bindDirectDrag'), app.indexOf('function bindFlowFreeDrag'));
assert.match(flowDragSource, /Положение карточки сохранено/, 'Flow layouts must persist a free card position');
assert.match(flowDragSource, /flowOffsetX = Math\.round[\s\S]{0,250}flowOffsetY = Math\.round/, 'Flow cards must move by pixel offsets instead of snapping to another grid cell');
assert.match(flowDragSource, /Math\.hypot\(dx, dy\) < 1/, 'Even a one-pixel movement must start a free drag');
assert.match(flowDragSource, /document\.addEventListener\('pointermove', onMove, true\)/, 'Flow dragging must remain active when the pointer leaves the source card');
assert.doesNotMatch(flowDragSource, /\.image-wrap/, 'Image bodies must remain draggable in overview mode');
assert.match(app, /function beginImageZoomPan[\s\S]{0,260}!event\.ctrlKey[\s\S]{0,180}event\.stopPropagation\(\)/, 'Only Ctrl-held image panning may intercept the shared card drag handler');
assert.match(directDragSource, /document\.addEventListener\('pointermove', onMove, true\)/, 'Freeform image and text dragging must survive leaving the source card');
assert.match(directDragSource, /pushCardLayoutUndo\([^)]*Перемещение/, 'Freeform movement must add a Ctrl+Z history step');
assert.match(app, /function draggedCardsFor\(id\)[\s\S]{0,180}selectedIds\.has\(id\) && selectedIds\.size > 1[\s\S]{0,120}ids\.has\(card\.id\)/, 'The shared drag target resolver must retain the whole selected group');
assert.match(directDragSource, /const targets = draggedCardsFor\(id\)/, 'Dragging a selected dashboard card must move the resolved selected group');
assert.match(app, /class="drag-handle"[\s\S]{0,180}выделенную группу/, 'Edit mode must expose an explicit handle for moving a card or selected group');
assert.match(app, /function bindFlowResize[\s\S]{0,2200}flowColumns[\s\S]{0,900}flowRows/, 'Flow cards must persist width and height changes in edit mode');
const imageZoomWheelSource = app.slice(app.indexOf("imageWrap?.addEventListener('wheel'"), app.indexOf("}, { passive:false });", app.indexOf("imageWrap?.addEventListener('wheel'")));
assert.match(imageZoomWheelSource, /event\.ctrlKey[\s\S]{0,500}getImageZoomPreview[\s\S]{0,500}session\.zoom/, 'Ctrl+wheel must start a temporary per-image zoom preview');
assert.doesNotMatch(imageZoomWheelSource, /card\.imageZoom|debouncedSave|saveCards/, 'Temporary image zoom must not change persisted card data');
assert.match(app, /imageWrap\?\.addEventListener\('pointerdown',[\s\S]{0,100}beginImageZoomPan/, 'A zoomed image must support Ctrl-held panning');
assert.match(app, /document\.addEventListener\('keyup',[\s\S]{0,180}resetImageZoomPreview/, 'Releasing Ctrl must restore the original image position and scale');
assert.match(app, /imageWrap\?\.addEventListener\('dblclick'[\s\S]{0,300}openExternalLink/, 'Double-clicking a linked image must open its URL');
assert.match(css, /\.image-card\.image-zoom-preview \{[^}]*overflow:visible !important/, 'Temporarily zoomed images must escape the card boundary');
assert.match(css, /\.image-card\.image-zoom-preview \.image-wrap \{[^}]*border-color:transparent !important[^}]*box-shadow:none !important/, 'The image frame must disappear during temporary zoom');
assert.match(css, /\.image-card\.image-zoom-preview \.card-header,[\s\S]{0,120}opacity:0 !important/, 'Card chrome must stay hidden while the image preview is active');
assert.match(app, /function cardsInNumberOrder[\s\S]{0,900}a\.number - b\.number/, 'Numeric card sorting must order numbered kickers from low to high');
assert.match(app, /\(\?=\$\|\\s\|\[·\.\\-:\]\)/, 'A bare number such as "1" must be accepted as a sortable card number');
assert.match(app, /card-kicker-label[\s\S]{0,300}contenteditable="true"[\s\S]{0,180}Номер или метка карточки/, 'The visible card label must be editable as a number or text tag');
assert.match(app, /function sortActiveCardsByNumber[\s\S]{0,1200}delete card\.flowOffsetX[\s\S]{0,250}delete card\.flowOffsetY/, 'One-click sorting must reset free offsets and restore a clean grid');
assert.match(app, /function restoreDeletedCard[\s\S]{0,1600}Карточка возвращена/, 'Deleted cards must be restorable from the undo history');
assert.match(app, /function undoLastCardAction[\s\S]{0,900}cardUndoHistory\.splice[\s\S]{0,500}restoreCardLayoutState/, 'Ctrl+Z history must support multiple layout actions in reverse order');
assert.match(app, /function isCardUndoShortcut[\s\S]{0,350}event\.code === 'KeyZ'/, 'Ctrl+Z must use the physical Z key with any keyboard layout');
assert.match(app, /cardUndoShortcut = isCardUndoShortcut\(event\)[\s\S]{0,500}undoLastCardAction\(\)/, 'The layout-independent shortcut must invoke multi-step card undo');
assert.match(app, /В этом пространстве больше нечего отменять/, 'Ctrl+Z must explain when the current workspace history is exhausted');
const undoShortcutStart = app.indexOf('function isCardUndoShortcut');
const undoShortcutEnd = app.indexOf('\n}', undoShortcutStart) + 2;
const undoShortcutContext = {};
vm.runInNewContext(`${app.slice(undoShortcutStart, undoShortcutEnd)}; this.isUndo=isCardUndoShortcut;`, undoShortcutContext);
assert.equal(undoShortcutContext.isUndo({ ctrlKey:true, metaKey:false, shiftKey:false, code:'KeyZ', key:'я' }), true, 'Russian/Ukrainian keyboard layouts must still trigger Ctrl+Z by physical key code');
assert.equal(undoShortcutContext.isUndo({ ctrlKey:true, metaKey:false, shiftKey:true, code:'KeyZ', key:'z' }), false, 'Ctrl+Shift+Z must remain available for a future redo command');
assert.match(main, /xai:key:verify[\s\S]{0,900}verifyAnswerApiKey/, 'New API keys must be verified before storage');
assert.match(main, /Запускать V вместе с Windows/, 'The tray must expose the Windows autostart setting');
assert.match(css, /\.layout-gallery \.antischool-card \.card-menu \{[^}]*opacity:\.78/, 'Antischool delete controls must remain visible in ordinary gallery mode');
assert.match(css, /\.layout-gallery[\s\S]{0,500}\.layout-list/, 'Gallery and list must provide flow layout styling');

const displayCardsStart = app.indexOf('function displayCards');
const displayCardsEnd = app.indexOf('function updateViewControls', displayCardsStart);
const displayCardsContext = {};
vm.runInNewContext(`${app.slice(displayCardsStart, displayCardsEnd)}; this.displayCards=displayCards;`, displayCardsContext);
const sourceCards = [{ id:'old', title:'Zulu', createdAt:1 }, { id:'new', title:'Alpha', createdAt:2 }];
const newestCards = displayCardsContext.displayCards(sourceCards, { layout:'gallery', sort:'newest' });
assert.equal(newestCards.map(card => card.id).join(','), 'new,old', 'Newest sorting must affect displayed cards');
assert.equal(sourceCards.map(card => card.id).join(','), 'old,new', 'Sorting a flow layout must not mutate manual source order');
assert.equal(displayCardsContext.displayCards(sourceCards, { layout:'list', sort:'title' }).map(card => card.id).join(','), 'new,old', 'Title sorting must work in list mode');
assert.equal(displayCardsContext.displayCards(sourceCards, { layout:'dashboard', sort:'newest' }).map(card => card.id).join(','), 'old,new', 'Dashboard must preserve manual source order');

const normalizeUrlStart = app.indexOf('function normalizeExternalUrl');
const normalizeUrlEnd = app.indexOf('async function openExternalLink', normalizeUrlStart);
const normalizeUrlContext = { URL };
vm.runInNewContext(`${app.slice(normalizeUrlStart, normalizeUrlEnd)}; this.normalize=normalizeExternalUrl;`, normalizeUrlContext);
assert.equal(normalizeUrlContext.normalize('docs.example.org/path'), 'https://docs.example.org/path', 'Bare web addresses must normalize to HTTPS');
assert.equal(normalizeUrlContext.normalize('javascript:alert(1)'), '', 'Non-web URL schemes must be rejected');
assert.equal(normalizeUrlContext.normalize('https://user:secret@example.org'), '', 'Credential-bearing external URLs must be rejected');

const storageHelpersEnd = app.indexOf('const seedCards');
const storageWrites = new Map();
const storageCallbacks = [];
const storageContext = {
  localStorage:{
    getItem:key => storageWrites.get(key) ?? null,
    setItem:(key, value) => storageWrites.set(key, value)
  },
  setTimeout:callback => { storageCallbacks.push(callback); return storageCallbacks.length; },
  console:{ error(){} },
  window:{ alert(){} }
};
vm.runInNewContext(`${app.slice(0, storageHelpersEnd)}; this.storageApi={safeStorageSet,safeJsonStorageSet};`, storageContext);
assert.equal(storageContext.storageApi.safeStorageSet('test', 42), true, 'Safe storage writes must report success');
assert.equal(storageWrites.get('test'), '42', 'Safe storage writes must preserve localStorage string semantics');
storageContext.localStorage.setItem = () => { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; };
assert.equal(storageContext.storageApi.safeJsonStorageSet('test', { value:1 }), false, 'Quota failures must be reported to callers instead of throwing');

const dedupeStart = app.indexOf('function normalizedPhrase');
const dedupeEnd = app.indexOf('function rebuildTranscriptFromUtterances');
assert.ok(dedupeStart > -1 && dedupeEnd > dedupeStart, 'Dedupe implementation must be extractable for unit testing');
const dedupeContext = {};
vm.runInNewContext(`${app.slice(dedupeStart, dedupeEnd)}; function dedupeTranscriptText(value){return dedupeStrings(String(value||'').split(/(?<=[.!?])\\s+|\\n+/).map(part=>part.trim()).filter(Boolean)).join('\\n');}; this.api={phraseSimilarity,dedupeStrings,sanitizeRecap};`, dedupeContext);
const duplicatedAccess = [
  'Доступ до цього всього у вас буде вже після навчання, але наглядно я вам покажу.',
  'Доступ до цього усього у вас буде після навчання, але я вам покажу.'
];
assert.equal(dedupeContext.api.dedupeStrings(duplicatedAccess).length, 1, 'Near-identical Ukrainian points from mic/system must collapse');
const cleanedRecap = dedupeContext.api.sanitizeRecap({ summary:'Коротко.', keyPoints:duplicatedAccess, decisions:[], questions:['Тому що рано вранці?','Тому що рано вранці, так?'], tasks:[], topics:[], playbook:[] });
assert.equal(cleanedRecap.keyPoints.length, 1, 'Recap key points must be unique');
assert.equal(cleanedRecap.questions.length, 1, 'Recap questions must be unique');
const objectRecap = dedupeContext.api.sanitizeRecap({
  summary:'Safe summary', keyPoints:[{ point:'Important point' }], decisions:[],
  questions:[{ question:'What happens next?' }],
  tasks:[{ title:'Follow up', owner:null, due:null }], topics:[], playbook:[]
});
assert.equal(objectRecap.questions[0], 'What happens next?', 'Object-shaped AI questions must normalize to renderable text');
assert.equal(objectRecap.keyPoints[0], 'Important point', 'Object-shaped AI points must normalize to renderable text');
assert.equal(objectRecap.tasks[0].owner, null, 'Nullable task metadata must remain safe to render');
const topicFallback = dedupeContext.api.sanitizeRecap({ summary:'', keyPoints:[], decisions:[], questions:[], tasks:[], playbook:[], topics:[{ title:'Pricing', summary:'State the confirmed price and conditions.' }] });
assert.equal(topicFallback.playbook[0].cue, 'Pricing', 'Structured topics must provide a useful cheat-sheet cue fallback');
assert.equal(topicFallback.playbook[0].response, 'State the confirmed price and conditions.', 'Structured topics must provide a useful cheat-sheet response fallback');

assert.doesNotMatch(app, /function bindDirectDrag[\s\S]{0,180}if \(!editMode\) return/, 'Dashboard cards must remain draggable in view and edit modes');
assert.match(app, /function requestHide\(\)[\s\S]{0,260}Only the[\s\S]{0,160}window\.sloy\?\.hide\(\)/, 'Hiding the overlay must not stop an active recording');
assert.match(app, /recordButton\.addEventListener\('click',[\s\S]{0,180}stopRecording\(\)/, 'The primary recording button must explicitly switch recording off');
assert.match(main, /compactTextSample[\s\S]{0,40000}completion\.reason === 'http_413'/, 'Board generation must compact oversized context and retry HTTP 413');
assert.match(main, /selectedSources\.length === 1/, 'Azure microphone-only capture must enable speaker diarization');
assert.match(main, /transcriptChars: 1200000/, 'Multi-hour transcripts must be accepted before model-safe chunking');
assert.match(main, /splitTextForModel\(transcript,[\s\S]{0,80}48000[\s\S]{0,80}32000/, 'Long summaries must be generated from bounded transcript chunks');
assert.match(main, /combineStructuredParts\(structuredParts\)/, 'Important points from every long-transcript chunk must be combined');
assert.match(app, /next\.keyPoints = dedupeStrings\(\[\.\.\.\(current\?\.keyPoints/, 'Live summary updates must retain previously collected important points');
assert.match(app, /recap\.keyPoints\.map\(point =>/, 'The important section must render every collected point without a display cap');
assert.doesNotMatch(app, /recap\.keyPoints\.slice\(0,(?:6|12)\)/, 'Important points must not be silently truncated to 6 or 12 entries');
assert.match(main, /liveContextChars = activeRoleplay \? 6000 : directAssistantQuery \? 11000 : 8000[\s\S]{0,180}liveOutputTokens = activeRoleplay \? 320 : directAssistantQuery \? 1000 : 650/, 'Realtime suggestions must use a bounded token budget instead of exhausting a free provider with every turn');
assert.match(main, /requestTextCompletion\(\{ system:systemPrompt, user:buildUserPrompt\(liveContextChars\), maxOutputTokens:liveOutputTokens[\s\S]{0,120}reasoningEffort:'low'/, 'Realtime assistant responses must use low-cost reasoning through the shared provider chain');
assert.match(preload, /onAiProgress: \(callback\) => subscribe\('ai:progress'/, 'Renderer must receive visible AI progress events');
assert.match(main, /reportProgress\(\{ phase:'structuring'[\s\S]{0,500}Анализирую часть/, 'Long transcript processing must report its current chunk');
assert.match(app, /function meetingProcessingMarkup/, 'Meeting cards must render explicit processing state');
assert.match(app, /processing-track[\s\S]{0,300}percent/, 'Processing state must include a determinate progress bar when chunk counts are known');
assert.match(css, /\.processing-track[\s\S]{0,700}@keyframes processing-slide/, 'Processing progress must remain visibly animated while totals are unknown');
assert.doesNotMatch(app, /Обработка не завершена/, 'Unknown failures must not look like an indefinitely running operation');
assert.match(css, /\.freeform-board \{[\s\S]{0,180}overflow: hidden/, 'The board must end at the current screen instead of becoming an infinite canvas');
assert.doesNotMatch(html, /board-pages|board-next-free/, 'The fixed board must not expose invented pagination or continuation controls');
assert.match(app, /function findMeetingBoardPlacement/, 'Recording startup must check whether its meeting hub fits on the fixed board');
assert.match(app, /else card\.detachedMeeting = true/, 'A meeting hub without board space must detach into its own window');
assert.match(app, /const detachedToSync = detachedMeetings\.find\(card => card\.id === recordingSession\?\.card\?\.id\)/, 'A detached meeting window must only be restored by its live recording session');
assert.doesNotMatch(app, /detachedMeetings\.at\(-1\)/, 'A saved detached meeting must not reopen automatically during application startup');
assert.match(main, /async function createMeetingWindow/, 'The desktop process must create the separate always-on-top meeting window');
assert.match(main, /Перезапустить V[\s\S]{0,120}restartApplication/, 'The tray must provide a real process restart instead of merely hiding and reopening the stale instance');
assert.doesNotMatch(main, /function updateMeetingWindow[\s\S]{0,500}hideAnswerPopup\(\)/, 'Meeting refreshes must not erase the floating answer window');
assert.match(main, /function showLatestAnswerPopup[\s\S]{0,500}showInactive\(\)[\s\S]{0,100}moveTop\(\)/, 'A held answer must be restored above other applications when the main overlay hides');
assert.match(main, /answer_popup_not_held/, 'Desktop smoke testing must verify that meeting refreshes cannot remove the floating answer');
assert.match(main, /finalized_meeting_controls_stale[\s\S]{0,500}finalized_meeting_window_not_closed/, 'Desktop smoke testing must verify that a completed meeting exposes a working close action');
assert.match(main, /const workspaceChatState[\s\S]{0,1600}workspace_chat_relevance_failed/, 'Desktop smoke testing must verify the real objection script is ranked and available offline');
assert.match(main, /ai_two_turn_pipeline_failed[\s\S]{0,300}SLOY_AI_SMOKE_PROVIDER[\s\S]{0,120}TWO_TURNS_READY/, 'The optional AI smoke test must prove that a second live turn replaces the first answer through the real provider router');
assert.match(main, /ai_workspace_chat_failed[\s\S]{0,300}SLOY_AI_WORKSPACE_PROVIDER/, 'The optional AI smoke test must require a relevant real-provider workspace answer');
assert.match(main, /uIOhook\.on\('keydown'[\s\S]{0,220}UiohookKey\.CapsLock[\s\S]{0,180}toggleAnswerSearchPause\(\)/, 'Caps Lock must globally toggle answer search pause without taking ownership of the key');
assert.doesNotMatch(main, /globalShortcut\.register\('Capslock'/, 'Caps Lock must not be registered as an exclusive shortcut because that breaks normal letter casing');
assert.match(launcher, /node_modules\\uiohook-napi\\package\.json/, 'The launcher must install the non-blocking Caps Lock observer when it is missing');
assert.match(main, /for \(const entry of activeSuggestionControllers\.values\(\)\) entry\.controller\.abort\(\)/, 'Freezing an answer must cancel an answer request already in flight');
assert.match(app, /recordingSession\.stopRequested \|\| answerSearchPaused/, 'Paused answer search must reject newly recognised questions before starting AI work');
assert.match(app, /requestPauseRevision !== answerPauseRevision/, 'A result started before a pause must never replace the held answer');
assert.match(html, /id="answer-pause"/, 'The recording panel must expose an on-screen answer freeze button');
assert.match(answerHtml, /id="pause"/, 'The floating answer must expose the same freeze control');
assert.match(preload, /onAnswerPauseState/, 'Pause state must be synchronised to both renderer windows');
assert.doesNotMatch(main, /function showLatestAnswerPopup\(\)[\s\S]{0,180}overlay\?\.isVisible\(\)/, 'The movable answer popup must remain available while the main workspace is open');
assert.match(main, /showOverlay\(\)[\s\S]{0,500}showLatestAnswerPopup\(\)/, 'Opening the workspace must restore the detached answer above it');
assert.match(html, /id="record-panel-drag"/, 'The recording controls must expose a visible drag handle');
assert.match(app, /enableMovableRecordPanel[\s\S]{0,1800}setPointerCapture/, 'The recording control panel must be movable without dragging its action buttons');
assert.match(css, /body\.light-theme #answer-pause \{[^}]*color:#332a9d[^}]*background:#e4e1ff/, 'The Caps Lock button must remain legible in the light theme');
assert.match(meetingHtml, /data-tab="important"[\s\S]{0,200}data-tab="cheats"[\s\S]{0,200}data-tab="transcript"/, 'Detached meeting window must keep important points, cheats, and transcript tabs');
assert.match(preload, /showMeetingWindow: \(payload\) => ipcRenderer\.send\('meeting:update'/, 'Meeting state must stream to the detached window');
assert.doesNotMatch(launcher, /[^\x00-\x7F\r\n\t]/, 'Windows launcher must stay ASCII-safe for cmd.exe');
assert.match(app, /render\(\);\s*document\.body\.dataset\.appReady = 'true'/, 'Renderer readiness must only be published after the initial board render succeeds');
assert.match(main, /renderer_not_initialized/, 'Smoke testing must fail when renderer initialization stops partway through');
assert.match(main, /rendererState\.antischoolCards !== 20/, 'Smoke testing must verify the complete Antischool migration');
assert.match(main, /!rendererState\.coachButton/, 'Smoke testing must verify the separate assistant control renders');
assert.match(html, /class="workspace-viewbar"[^>]*hidden/, 'The obsolete top layout bar must stay hidden');
assert.match(app, /requestedLayout = \['dashboard','gallery','list'\]/, 'A workspace-specific gallery must survive application restart');
assert.match(app, /workSpace\.view = \{ layout:'gallery', sort:'manual' \}/, 'The 20-card Antischool workspace must use the compact gallery inside the screen');
assert.match(app, /if \(\['transcribing','structuring'\]\.includes\(card\.processing\)\)/, 'Repeated transcript or summary clicks must not start duplicate AI work');
assert.match(app, /meetingAiActionStatusMarkup/, 'Meeting cards must remember whether AI processing was requested and completed');
assert.match(app, /pendingSegments = card\.segments\.filter[\s\S]{0,500}for \(const segment of segmentsToProcess\)/, 'Manual retry must process every still-untranscribed meeting segment');
assert.match(app, /autoTranscribe:true, autoStructure:true/, 'A manual transcript command must work even when automatic processing is disabled');
assert.match(app, /recordButton\.addEventListener\('click',[\s\S]{0,1200}startRecording/, 'The primary recording button must remain connected to recording start');
assert.match(app, /#record-stop'\)\.addEventListener\('click',[\s\S]{0,180}coachOnlySessionActive[\s\S]{0,120}stopRecording/, 'The shared stop control must stop either coach-only listening or full recording explicitly');
assert.match(app, /async function startCoachOnly[\s\S]{0,5000}coachOnly:true, card:null/, 'Coach-only mode must use an ephemeral session without creating a meeting card');
const coachStart = app.indexOf('async function startCoachOnly');
const recordingStart = app.indexOf('async function startRecording', coachStart);
assert.doesNotMatch(app.slice(coachStart, recordingStart), /new MediaRecorder|createRecordingCard|saveAudio|persistWorkspaces/, 'Coach-only mode must not record, save, or persist audio and transcripts');
assert.match(app, /getWorkspaceContext\(recordingSession\?\.spaceId, question\)/, 'Realtime answers must rank workspace knowledge for the current spoken question');
assert.match(app, /РЕЖИМ: AI-ПОМОЩНИК БЕЗ ЗАПИСИ/, 'The answer prompt must explicitly distinguish non-recording assistant mode');
assert.match(main, /isSmokeTest[\s\S]{0,180}app\.setPath\('userData'/, 'Smoke tests must not reuse or mutate the real user profile');
assert.match(app, /appendPlaybookEntry\(recordingSession\.card, question, suggestion\)/, 'Successful live answers must be saved into the conversation cheat sheet');
assert.match(app, /function mergeStructuredRecap/, 'Later AI summaries must preserve already collected cheat sheets');
assert.match(app, /card\.structured \? \{ structured:sanitizeRecap\(card\.structured\) \}/, 'Saved meetings in inactive workspaces must restore their cheat sheets during startup');
assert.match(preload, /xaiBoardCheats: \(payload\) => ipcRenderer\.invoke\('xai:board-cheats'/, 'Renderer must expose the protected board-cheat AI command');
assert.match(main, /xai:board-cheats/, 'Main process must generate multiple board cheat cards from a user instruction');
assert.match(app, /class="board-ai-composer"/, 'Meeting cheat tab must expose a user instruction composer');
assert.match(app, /function publishMeetingBoardCards/, 'One meeting must be expandable into several standalone board cards');
assert.match(app, /class="recap-section recap-important"/, 'The most important recap points must use a dedicated visual block');
assert.match(css, /\.meeting-pane \{[^}]*overflow-y:auto/, 'Long meeting content must scroll instead of being clipped by the fixed card height');
assert.match(css, /\.recap-important \{/, 'Important recap points must receive a strong visual treatment');
assert.match(app, /function crossSpaceDropTargetAtPoint[\s\S]{0,700}\.space\[data-space\]/, 'Dragging a card must discover another workspace directly under the pointer');
assert.match(app, /function moveCardsToWorkspace[\s\S]{0,2200}type:'move-space'/, 'Cross-workspace card moves must be persisted as one undoable action');
assert.match(app, /linkedKnowledge[\s\S]{0,500}targetKnowledge\.items\.push/, 'Moving a card must carry its linked knowledge items into the destination workspace');
assert.match(app, /function blockedCrossSpaceCard[\s\S]{0,500}meetingState !== 'finalized'/, 'An active or unfinished meeting card must not be transferable while its runtime state is live');
assert.match(css, /\.space\.card-drop-target/, 'The destination workspace must visibly highlight during a card transfer');

const questionStart = app.indexOf('function inferAssistantIntent');
const questionEnd = app.indexOf('async function requestLiveSuggestion', questionStart);
const questionContext = { liveUtterances:[{},{}], transcriptText:'Контекст разговора уже содержит достаточно текста для проверки прямого вопроса.' };
vm.runInNewContext(`${app.slice(questionStart, questionEnd)}; this.inferIntent=inferAssistantIntent; this.detect=looksLikeAddressedQuestion; this.classifyAssistantTurn=classifyAssistantTurn; this.detectAssistantTurn=looksLikeMeaningfulAssistantTurn; this.detectCoachStart=looksLikeCoachRequest; this.expectsReply=assistantExpectsReply; this.updateScenario=updateCoachScenario; this.localRoleplay=localRoleplayReply;`, questionContext);
assert.equal(questionContext.detect('Чи ви можете розповісти, коли будете готові?'), true, 'Ukrainian direct questions must trigger the coach');
assert.equal(questionContext.detect('Could you tell me when you will be ready?'), true, 'English direct questions must trigger the coach');
assert.equal(questionContext.detect('Мой ответ she will do it'), false, 'Quoted or declarative self-answers must not trigger the coach');
questionContext.liveUtterances.length = 0;
questionContext.transcriptText = '';
assert.equal(questionContext.detect('Які є хибні заперечення.', { allowFirstQuestion:true }), true, 'A direct Ukrainian mic question must trigger coach-only mode even as the first utterance and without a question mark');
assert.equal(questionContext.detectAssistantTurn('Мені треба підготувати розмову з клієнтом.'), true, 'A meaningful problem statement must reach the full assistant even without a question form');
assert.equal(questionContext.detectAssistantTurn('ем'), false, 'A tiny recognition fragment must not waste an assistant request');
assert.equal(questionContext.detectAssistantTurn('Сегодня мы просто обсуждали расписание занятий.'), false, 'An ordinary complete statement must not spend an assistant request');
assert.equal(questionContext.classifyAssistantTurn('Я хотел спросить').action, 'wait', 'An unfinished lead-in must wait for the rest of the thought');
assert.equal(questionContext.classifyAssistantTurn('Подскажи, пожалуйста, как…').action, 'wait', 'A request ending in an open question word must not launch prematurely');
assert.equal(questionContext.classifyAssistantTurn('Я хотел спросить, как лучше ответить клиенту?').action, 'respond', 'A completed question in the middle of a larger thought must launch the assistant');
assert.equal(questionContext.classifyAssistantTurn('Он сказал, что сегодня будет занят.').action, 'ignore', 'Reported background speech must not be mistaken for a direct assistant request');
assert.equal(questionContext.classifyAssistantTurn('Дорого', { continuationMode:true, roleplay:true }).action, 'respond', 'A short objection remains a valid completed turn during role-play');
assert.equal(questionContext.classifyAssistantTurn('Мне это слишком дорого.', { interlocutorMode:true }).action, 'respond', 'A completed interlocutor objection must trigger a recording-mode suggestion without a question mark');
assert.equal(questionContext.classifyAssistantTurn('Сегодня мы обсуждали расписание.', { interlocutorMode:true }).action, 'ignore', 'Ordinary interlocutor narration must not spend an answer request');
assert.equal(questionContext.classifyAssistantTurn('Проверь').action, 'respond', 'A one-word explicit command must not be discarded as a speech fragment');
assert.equal(questionContext.classifyAssistantTurn('Оно вообще бездействует и не отвечает.').action, 'respond', 'A completed problem description must be treated as a direct request for help');
[
  'Какая цена',
  'Какой вариант лучше',
  'Можно подключить Gemini',
  'Есть смысл добавлять ещё одну модель',
  'Gemini ключ работает ты тестировал',
  'В чём проблема',
  'Який варіант краще',
  'Ти перевіряв ключ',
  'Does it work'
].forEach(value => assert.equal(questionContext.classifyAssistantTurn(value).action, 'respond', `A punctuation-free direct question must launch the assistant: ${value}`));
[
  'Сегодня мы обсуждали расписание.',
  'Я думаю, что это работает.',
  'Ключ вроде работает.',
  'Клиент спросил, работает ли ключ.'
].forEach(value => assert.equal(questionContext.classifyAssistantTurn(value).action, 'ignore', `Ordinary or reported speech must not launch the assistant: ${value}`));
assert.equal(questionContext.classifyAssistantTurn('Подскажи, пожалуйста, как…', { forceComplete:true }).action, 'respond', 'A request held through the completion timeout must not disappear silently');
[
  'Мне бы хотелось, чтобы карточки можно было переносить между пространствами',
  'Я хочу, чтобы ты сравнил Cerebras и Gemini',
  'Хорошо бы добавить кнопку отмены',
  'Не могу определиться между Cerebras и Gemini',
  'Сомневаюсь, стоит ли добавлять Gemini',
  'Cerebras быстрее, но точность тоже важна',
  'Боюсь, что бесплатных лимитов не хватит',
  'Меня смущает необходимость прокси',
  'Мені хотілося б, щоб картки можна було переносити між просторами',
  'Не можу визначитися між Cerebras і Gemini',
  'Мене бентежить необхідність проксі'
].forEach(value => assert.equal(questionContext.classifyAssistantTurn(value, { directAssistantMode:true }).action, 'respond', `An indirect first-person need must launch direct assistant mode: ${value}`));
[
  'Нет, я имел в виду перенос, а не копирование',
  'Это не то',
  'А подробнее',
  'По шагам',
  'На примере',
  'А другой вариант',
  'То есть бесплатно',
  'Получается бесплатно',
  'Продолжай',
  'Не уверен',
  'Ні, я мав на увазі перенесення, а не копіювання'
].forEach(value => assert.equal(questionContext.classifyAssistantTurn(value, { continuationMode:true, directAssistantMode:true }).action, 'respond', `A contextual follow-up must continue the active assistant dialogue: ${value}`));
[
  'Работает стабильно',
  'Стоит дом на горе',
  'Нужно время',
  'Нормально всё прошло',
  'Правильно настроенная система работает',
  'Працює стабільно',
  'Потрібно більше часу',
  'Сегодня мы обсуждали два варианта',
  'Он не уверен, какой вариант выбрать',
  'Сейчас расскажу, какие есть варианты',
  'Cerebras работает быстро',
  'Я думаю, что Cerebras быстрый'
].forEach(value => assert.equal(questionContext.classifyAssistantTurn(value, { directAssistantMode:true }).action, 'ignore', `A declarative or narrated phrase must not spend an AI request: ${value}`));
assert.equal(questionContext.expectsReply({ lastAssistantSuggestion:'Какой вариант для вас важнее?', lastAssistantSuggestionAt:Date.now() }), true, 'A recent assistant question must open the narrow answer-shaped reply state');
assert.equal(questionContext.classifyAssistantTurn('Первый', { continuationMode:true, directAssistantMode:true, expectedReply:true }).action, 'respond', 'A short answer to an assistant clarification must continue naturally');
assert.equal(questionContext.classifyAssistantTurn('Да', { continuationMode:true, directAssistantMode:true, expectedReply:true }).action, 'respond', 'A yes/no answer must not be mistaken for background filler while a reply is expected');
assert.equal(questionContext.classifyAssistantTurn('Да', { continuationMode:true, directAssistantMode:true, expectedReply:false }).action, 'ignore', 'A bare acknowledgement must stay silent when the assistant did not ask anything');
assert.equal(questionContext.detectCoachStart('Давай відпрацюємо діалог продажу.'), true, 'A spoken role-play request must start an ongoing coach dialogue without requiring a question mark');
assert.equal(questionContext.inferIntent('Для чого потрібне питання-заклик?'), 'explain', 'Purpose questions must request an explanation rather than a card excerpt');
assert.equal(questionContext.inferIntent('Скільки є етапів обробки заперечень?'), 'enumerate', 'Stage questions must request an exact ordered list');
assert.equal(questionContext.inferIntent('Що відповісти клієнту, якщо він каже дорого?'), 'draft_response', 'Reply requests must produce a ready-to-say phrase');
assert.match(main, /directAssistantQuery[\s\S]{0,1400}ПОВНОЦІННИЙ AI-ПОМІЧНИК/, 'The AI prompt must distinguish a direct microphone turn from an interlocutor question');
assert.match(main, /ПОВНОЦІННИЙ AI-ПОМІЧНИК[\s\S]{0,900}Не зводь допомогу до пошуку однієї картки/, 'Direct assistant mode must support reasoning and task completion instead of returning a card excerpt');
assert.match(main, /повноцінний розумний асистент робочого простору[\s\S]{0,1600}Зроби синтез[\s\S]{0,1600}Питання «навіщо\/для чого»/, 'Direct assistant mode must use a dedicated synthesis prompt instead of the meeting hint template');
assert.match(app, /function inferAssistantIntent[\s\S]{0,1200}draft_response[\s\S]{0,1200}enumerate/, 'Spoken requests must be classified by the kind of help the user actually needs');
assert.match(app, /sharedAssistantMode = Boolean\(recordingSession\?\.coachOnly \|\| continuationMode \|\| session\.coachScenario\?\.active\)[\s\S]{0,500}assistantMode:sharedAssistantMode[\s\S]{0,220}questionSource/, 'Both live modes must pass their shared dialogue state and explicit speaker-source semantics to the answer model');
assert.match(app, /coachDialogueUntil = Date\.now\(\) \+ 45 \* 1000/, 'Coach mode must keep a short bounded follow-up window without treating five minutes of ordinary speech as AI requests');
assert.match(app, /coachTurns = session\.coachTurns\.slice\(-18\)/, 'The assistant must retain enough completed turns to follow a longer conversation thread');
assert.match(app, /const coachHistory = \(session\.coachTurns \|\| \[\]\)\.slice\(-8\)[\s\S]{0,250}slice\(-4000\)/, 'Recent completed turns must be retained without overflowing the provider request');
assert.match(app, /ПРЕДЫДУЩИЕ ХОДЫ ПОМОЩНИКА/, 'Each continuation must include the assistant replies from earlier turns');
assert.match(main, /СПЕЦІАЛЬНИЙ РЕЖИМ — ПРОДОВЖЕННЯ ДІАЛОГУ/, 'The answer model must treat declarative objections as valid next dialogue turns');
assert.match(main, /Коротке заперечення[\s\S]{0,120}«дорого»[\s\S]{0,120}валідний хід/, 'Continuation prompting must not reject short sales objections as declarative noise');
const roleplaySession = { coachOnly:true, spaceId:'work', coachScenario:null };
const roleplayScenario = questionContext.updateScenario(roleplaySession, 'Давай отыграем диалог: ты клиент, который не заинтересован. Теперь твой черед.');
assert.equal(roleplayScenario.assistantRole, 'client', 'Spoken role-play setup must persist the AI client role');
assert.equal(roleplayScenario.userRole, 'manager', 'Spoken role-play setup must persist the user manager role');
const factualSession = { coachOnly:true, spaceId:'work', coachScenario:null };
const accidentalRoleplay = questionContext.updateScenario(factualSession, 'Сколько есть этапов отработки возражений?');
assert.equal(Boolean(accidentalRoleplay?.active), false, 'The word “отработка” in a knowledge question must not start role-play');
questionContext.updateScenario(factualSession, 'Давай отыграем диалог: ты клиент, я менеджер.');
assert.equal(factualSession.coachScenario.active, true, 'An explicit role assignment must still start role-play');
questionContext.updateScenario(factualSession, 'Какие этапы обработки возражений существуют?');
assert.equal(factualSession.coachScenario.active, false, 'A factual methodology question must exit a previously active role-play');
assert.match(questionContext.localRoleplay(roleplaySession, 'Здравствуйте, я звоню из онлайн-школы английского.'), /не очень интересно/i, 'Local fallback must continue the assigned client role when the cloud model is rate-limited');
assert.match(main, /СПЕЦІАЛЬНИЙ РЕЖИМ — РОЛЬОВИЙ ДІАЛОГ[\s\S]{0,1400}Відповідай ЛИШЕ наступною природною реплікою/, 'The answer model must receive an explicit persistent role-play contract');
assert.match(app, /Карточки — только скрытые источники[\s\S]{0,220}никогда не показывай их названия/, 'Role-play must use cards as hidden sources instead of displaying them');
assert.match(main, /const BLUESMINDS_CONFIG_PATH = String\(process\.env\.SLOY_BLUESMINDS_CONFIG \|\| ''\)/, 'A reserve provider path must require explicit app configuration');
assert.match(main, /if \(!BLUESMINDS_CONFIG_PATH\)/, 'A reserve provider must never import an unrelated project key implicitly');
assert.match(main, /providerAttemptLimit = Math\.max[\s\S]{0,160}for \(const attempt of readyAttempts\)[\s\S]{0,120}retry < providerAttemptLimit/, 'Text generation must continue through every provider while allowing live requests to disable slow same-provider retries');
assert.match(main, /const transient = \[408,425,500,502,503,504\]/, 'Recoverable provider failures may retry once without treating a rate limit as retryable');
assert.match(main, /if \(response\.status === 429\)[\s\S]{0,500}pauseRateLimitedProvider[\s\S]{0,300}if \(response\.status === 429\) break/, 'Rate-limited keys must enter cooldown and immediately yield to the next provider');
assert.match(main, /const providerCooldowns = new Map\(\)/, 'Provider cooldowns must survive across live suggestion requests in the running app');
const providerResetContext = {};
vm.runInNewContext(`${main.slice(main.indexOf('function parseProviderResetSeconds'), main.indexOf('function providerCooldown'))}\nthis.parseReset = parseProviderResetSeconds;`, providerResetContext);
assert.equal(providerResetContext.parseReset('2m59.56s'), 180, 'Groq compound reset headers must be converted into a usable cooldown');
assert.equal(providerResetContext.parseReset('7.66s'), 8, 'Fractional token reset headers must round up so requests never resume early');
assert.match(main, /reason:rateLimited \? 'http_429'/, 'A shared Groq rate limit must remain visible even when later reserve providers are also unavailable');
assert.match(main, /async function getGroqKeys[\s\S]{0,1500}new Set\(keys\.filter\(Boolean\)\)/, 'Groq credentials must be loaded as a deduplicated protected pool');
assert.match(main, /groqRotationIndex[\s\S]{0,900}orderedGroqKeys\.map[\s\S]{0,500}providerSlot:slot/, 'Text generation must round-robin through every configured Groq key');
assert.match(main, /xaiRotationIndex[\s\S]{0,900}orderedXaiKeys\.map[\s\S]{0,500}providerSlot:slot/, 'Text generation must round-robin through every configured xAI key');
assert.match(main, /xai:key:remove/, 'A single stored answer key must be removable without clearing the whole pool');
assert.match(main, /function extractCerebrasKey[\s\S]{0,180}csk-/, 'Cerebras credentials must be parsed without weakening other key formats');
assert.match(main, /store\.cerebrasKeys[\s\S]{0,500}safeStorage\.encryptString/, 'Cerebras credentials must only be persisted through protected storage');
assert.match(main, /api\.cerebras\.ai\/v1\/chat\/completions[\s\S]{0,300}gpt-oss-120b/, 'Cerebras must participate in the shared text-provider router');
assert.match(diagnoseAi, /Cerebras chat[\s\S]{0,180}api\.cerebras\.ai\/v1\/chat\/completions/, 'AI diagnostics must reveal when the primary Cerebras reserve is actually missing');
assert.match(main, /if \(webSearch\) attempts\.push\(\.\.\.geminiAttempts, \.\.\.xaiAttempts, \.\.\.cerebrasAttempts\)[\s\S]{0,220}attempts\.push\(\.\.\.cerebrasAttempts, \.\.\.xaiAttempts\)[\s\S]{0,120}if \(!preferGemini\) attempts\.push\(\.\.\.geminiAttempts\)[\s\S]{0,100}attempts\.push\(\.\.\.groqAttempts\)/, 'Normal text routing must use Cerebras, Grok/xAI, Gemini, then Groq, while web mode must prefer search-capable providers');
assert.match(main, /function extractGeminiKey[\s\S]{0,220}AIza[\s\S]{0,120}AQ\\\./, 'Gemini credentials must accept current AI Studio key formats');
assert.match(main, /store\.geminiKeys[\s\S]{0,500}safeStorage\.encryptString/, 'Gemini credentials must only be persisted through protected storage');
assert.match(main, /gateway\.ai\.cloudflare\.com[\s\S]{0,500}gemini-3\.1-flash-lite:generateContent[\s\S]{0,450}x-goog-api-key/, 'Gemini 3.1 Flash-Lite must use the configured Cloudflare gateway with Google key-header authentication');
assert.match(main, /responseMimeType:'application\/json'[\s\S]{0,80}responseSchema:jsonSchema/, 'Gemini structured output must use the actual Gemini generationConfig schema fields');
assert.match(main, /spaceChatContextChars: 160000/, 'Workspace chat IPC must reject accidentally oversized context packets');
assert.match(main, /const initialContextChars = Math\.min\(120000[\s\S]{0,180}sendRequest\(30000\)/, 'Workspace chat must use a compact packet and a bounded retry after provider input limits');
assert.doesNotMatch(app, /slice\(0,900000\)/, 'Workspace chat must never send the entire unranked board to a provider');
assert.match(main, /handleTrusted\('space:chat'[\s\S]{0,10000}action="create_cards"[\s\S]{0,10000}schemaName:'space_chat'/, 'The protected workspace chat endpoint must distinguish answers from card-creation commands');
assert.match(main, /completion\.reason === 'http_413'[\s\S]{0,260}buildUserPrompt\(4000\)/, 'Oversized live suggestions must retry with a much smaller evidence packet');
assert.match(html, /id="ai-key-add-field"/, 'AI settings must let the user add multiple provider keys');
assert.match(html, /placeholder="csk-…, xai-…, AQ\. … \/ AIza… или gsk_…"|placeholder="csk-…, xai-…, AQ\.\.\. \/ AIza… или gsk_…"|placeholder="csk-…, xai-…, AQ.… \/ AIza… или gsk_…"/, 'AI settings must accept Gemini keys alongside Cerebras, xAI, and Groq');
assert.match(preload, /removeXaiKey: \(id\)/, 'Per-key removal must stay behind the protected preload bridge');
assert.match(preload, /spaceChat: \(payload\) => ipcRenderer\.invoke\('space:chat', payload\)/, 'Workspace chat requests must stay behind the protected preload bridge');
assert.match(main, /Назви карток — лише службові мітки[\s\S]{0,800}кількох карток/, 'Realtime prompting must combine semantically relevant facts instead of requiring an exact card title');

const similarityStart = app.indexOf('function normalizedPhrase');
const similarityEnd = app.indexOf('function dedupeStrings', similarityStart);
const readbackStart = app.indexOf('function looksLikeSuggestionReadback');
const readbackEnd = app.indexOf('async function requestLiveSuggestion', readbackStart);
const readbackContext = {};
vm.runInNewContext(`${app.slice(similarityStart, similarityEnd)}; ${app.slice(readbackStart, readbackEnd)}; this.detectReadback=looksLikeSuggestionReadback;`, readbackContext);
const readbackSession = {
  coachOnly:false,
  lastAssistantSuggestion:'I understand. Let us choose a convenient schedule and arrange a trial lesson.',
  lastAssistantSuggestionAt:Date.now()
};
assert.equal(readbackContext.detectReadback(readbackSession, 'Let us choose a convenient schedule and arrange a trial lesson.'), true, 'Reading the latest suggestion aloud during a recording must not create a new assistant turn');
assert.equal(readbackContext.detectReadback(readbackSession, 'How much does the full course cost?'), false, 'A genuinely new interlocutor phrase must continue the conversation');
const liveSchedule = app.slice(app.indexOf('function scheduleLiveSuggestion'), app.indexOf('function looksLikeCoachRequest'));
assert.ok(liveSchedule.includes('looksLikeSuggestionReadback') && liveSchedule.includes('awaitingInterlocutor = true') && liveSchedule.indexOf('looksLikeSuggestionReadback') < liveSchedule.indexOf('suggestionCandidate = mergeSuggestionRequests'), 'Reading a suggestion must be filtered before a new assistant turn is queued');
assert.match(liveSchedule, /if \(!coachOnly && source === 'mic' && looksLikeSuggestionReadback/, 'Direct assistant follow-ups must never be discarded by the meeting readback detector');
assert.match(liveSchedule, /recentAssistantDialogue = Boolean\(coachOnly[\s\S]{0,900}continuingDialogue = Boolean[\s\S]{0,180}recentAssistantDialogue/, 'A direct assistant must accept natural follow-ups throughout its bounded conversation memory');
assert.ok(liveSchedule.includes('classifyAssistantTurn') && liveSchedule.includes('flushSuggestionCandidate') && liveSchedule.indexOf('classifyAssistantTurn') < liveSchedule.indexOf('requestLiveSuggestion(candidate.question'), 'Coach-only speech must pass a local completion and intent gate before any provider request');
assert.match(liveSchedule, /interlocutorMode = Boolean\(!coachOnly && semanticSource === 'system'\)/, 'System audio must be treated as the interlocutor in recording mode');
assert.match(liveSchedule, /mergeWindowMs:turnGate \? \(liveProvider === 'groq' \? 8500 : 6500\) : 3500/, 'Assistant fragments must remain mergeable across a natural pause and across Groq chunk boundaries');
assert.match(liveSchedule, /pendingCoachTurn[\s\S]{0,500}pendingFollowUp[\s\S]{0,700}continuingDialogue/, 'A contextual follow-up must remain valid while the previous provider request is still in flight');
assert.match(liveSchedule, /directAssistantMode:coachOnly[\s\S]{0,700}expectedReply/, 'Direct-mode and awaiting-reply state must survive candidate merge and delayed flush');
assert.match(app, /const shortDialogueTurn = Boolean\(\(roleplay \|\| interlocutorMode\) && objectionTurn\)/, 'Recording mode must classify completed interlocutor objections as dialogue turns');
assert.match(app, /if \(shortDialogueTurn\) intentScore \+= 3/, 'Completed interlocutor objections must launch a suggestion without requiring a question mark');
assert.match(app, /assistant-readback[\s\S]{0,300}озвучиваете подсказку/, 'The transcript must visibly distinguish the user reading an AI suggestion');
assert.match(app, /id:meetingId[\s\S]{0,600}coachTurns:\[\][\s\S]{0,240}awaitingInterlocutor:false/, 'A saved recording must initialize the same assistant memory as coach-only mode');
assert.match(app, /РЕЖИМ: ЗАПИСЬ ВСТРЕЧИ С AI-ПОДСКАЗКАМИ[\s\S]{0,500}сохраняй цепочку диалога/, 'Recording mode must explicitly receive the shared intelligent-assistant contract');

const turnCollectorStart = app.indexOf('function liveSuggestionsEnabled');
const turnCollectorEnd = app.indexOf('function phraseSimilarity', turnCollectorStart);
const turnCollectorContext = {
  recordingSession:{ coachOnly:true },
  loadAiSettings:() => ({ liveSuggestions:false }),
  liveSuggestionTurns:{ mic:[], system:[] },
  liveLastFinalAt:{ mic:0, system:0 }
};
vm.runInNewContext(`${app.slice(turnCollectorStart, turnCollectorEnd)}; this.enabled=liveSuggestionsEnabled; this.ingest=ingestLiveSuggestionBoundary;`, turnCollectorContext);
assert.equal(turnCollectorContext.enabled(), true, 'Direct assistant mode must answer even if meeting suggestions were disabled in saved settings');
const boundaryQuestion = 'Почему помощник больше не отвечает';
assert.equal(turnCollectorContext.ingest({ isFinal:true, speechFinal:false, text:boundaryQuestion }, 'mic'), '', 'A chunk-final event must wait for the actual speech boundary');
assert.equal(turnCollectorContext.ingest({ isFinal:true, speechFinal:true, text:boundaryQuestion }, 'mic'), boundaryQuestion, 'A duplicate speech-final event must still commit and launch the completed turn');
assert.match(html, /id="xai-internet-search"/, 'AI settings must expose an explicit opt-in for internet grounding');
assert.match(app, /internetSearch:false/, 'Internet search must remain off by default to protect Gemini search quota');
assert.match(app, /internetSearch:Boolean\(session\.coachOnly && loadAiSettings\(\)\.internetSearch\)/, 'Only the direct assistant must send the opt-in internet flag to the protected process');
assert.match(main, /tools:\[\{ google_search:\{\} \}\]/, 'Gemini web mode must use the official Google Search grounding tool');
assert.match(main, /model:webSearch \? 'grok-4\.5'[\s\S]{0,300}tools:\[\{ type:'web_search' \}\]/, 'Web mode must fall back from Gemini grounding to the official Grok web-search tool');
assert.match(main, /function extractGeminiGrounding[\s\S]{0,1000}groundingChunks[\s\S]{0,600}webSearchQueries/, 'Grounded answers must retain their web sources and executed search queries');
assert.match(main, /if \(webSearch\) attempts\.push\(\.\.\.geminiAttempts, \.\.\.xaiAttempts, \.\.\.cerebrasAttempts\)/, 'Internet mode must try both search-capable providers before models without web grounding');

const localSearchStart = app.indexOf('function rankWorkspaceKnowledgeEntries');
const localSearchEnd = app.indexOf('function scheduleLiveCardsRender', localSearchStart);
const localSearchContext = {
  workspaces:[{ id:'work', knowledge:{ summary:'', facts:[], playbook:[{ cue:'Возражение дорого', response:'Понимаю, цена важна — давайте сравним пользу.' }], items:[] }, cards:[
    { id:'advantages', title:'Переваги школи', knowledgeText:'• №1 у рейтингу шкіл англійської 2025\n• Студент говорить 50–70% уроку' },
    { id:'price', title:'Ціни', knowledgeText:'6 уроків — 3 899 грн' },
    { id:'objection-steps', title:'Этапы обработки возражений', knowledgeText:'1. Присоединение. 2. Уточнение. 3. Аргумент. 4. Вопрос-призыв.' }
  ] }],
  recordingSession:null,
  workspaceKnowledge:space => space.knowledge,
  dedupeStrings:values => [...new Set(values)],
  document:{ createElement:() => ({ innerHTML:'', innerText:'', textContent:'' }) }
};
vm.runInNewContext(`${app.slice(localSearchStart, localSearchEnd)}; this.findAnswer=findLocalWorkspaceAnswer;`, localSearchContext);
const localAdvantages = localSearchContext.findAnswer('work', 'Які є переваги школи.');
assert.match(localAdvantages, /№1[\s\S]*50–70%/, 'A recognised knowledge question must synthesize relevant facts even when the response model is unavailable');
assert.doesNotMatch(localAdvantages, /Переваги школи/, 'Local fallback must not expose a card title as if it were an answer');
const localObjectionSteps = localSearchContext.findAnswer('work', 'Сколько есть этапов обработки возражений?');
assert.match(localObjectionSteps, /Присоединение[\s\S]*Уточнение[\s\S]*Аргумент[\s\S]*Вопрос-призыв/, 'A methodology question must return the stages instead of an arbitrary sales reply');
assert.doesNotMatch(localObjectionSteps, /цена важна/, 'A factual question must not be replaced by a playbook phrase');
const localCallToAction = localSearchContext.findAnswer('work', 'Для чого нам потрібне питання-заклик?');
assert.match(localCallToAction, /конкретного наступного кроку[\s\S]*сьогодні чи завтра/, 'Local fallback must explain the purpose of a call-to-action question instead of dumping a card');
assert.match(app, /semanticGroups[\s\S]{0,900}переваг[\s\S]{0,120}преимущ[\s\S]{0,120}плюс/, 'Local retrieval must expand common cross-language synonyms');
assert.match(app, /ДОКАЗОВИЙ ПАКЕТ ІЗ БАЗИ ЗНАНЬ[\s\S]{0,250}slice\(0,7000\)/, 'The model must receive a compact multi-source evidence pack instead of an unbounded raw card dump');
assert.match(app, /selected\.length >= 3/, 'Local fallback must be able to combine several relevant knowledge entries');
assert.match(app, /const wantsReadyResponse[\s\S]{0,700}readyResponse = wantsReadyResponse/, 'Local fallback must return a scripted reply only when the user actually asks what to say');
assert.match(app, /const wantsStructuredList[\s\S]{0,500}structuredSource\.text/, 'Local fallback must preserve short numbered stages in methodology answers');
assert.match(app, /class="copy-summary"[\s\S]{0,1800}function structuredNotesText/, 'Generated summaries must expose a plain-text copy action');
assert.match(preload, /copyText: \(text\) => ipcRenderer\.invoke\('clipboard:write-text'/, 'Clipboard access must stay behind the protected preload bridge');
assert.match(css, /\.structured-notes \{[^}]*user-select:text/, 'Generated summary text must be selectable');
assert.match(app, /reason === 'missing_key'[\s\S]{0,180}Azure распознаёт речь/, 'Provider failures must explain that Azure STT and answer generation are separate services');
assert.doesNotMatch(app, /Автоматичний повтор уже виконано/, 'A rate-limited provider must not claim an immediate retry that would only consume more quota');
assert.match(app, /output\.textContent = fallback;[\s\S]{0,120}suggestion:fallback/, 'A useful local answer must stay clean instead of being covered by a repeated technical warning');
assert.match(app, /Локальная подсказка · \$\{fallbackReason\}/, 'Provider cooldown details must remain visible in the recording status without polluting the answer popup');
assert.match(app, /Реплика распознана · определяю, нужен ли ответ/, 'The direct assistant must visibly acknowledge a completed utterance while its local gate is deciding');
assert.match(app, /Подсказка готова · \$\{providerLabel\}/, 'The live status must identify when a cloud answer is actually ready');
assert.match(app, /const ticket = suggestionGate\.begin\(session, question\)/, 'A second completed turn must replace and cancel the stale in-flight answer');
assert.match(preload, /cancelXaiSuggest:[\s\S]{0,120}xai:suggest:cancel/, 'Latest-wins replacement must address cancellation through the protected bridge');
assert.match(main, /attemptsPerProvider:1, timeoutMs:useInternet \? 7500 : 3500, totalTimeoutMs:useInternet \? 16000 : 10000/, 'Live answers must keep a short bounded reserve chain while allowing extra time only for opted-in web grounding');
assert.match(app, /const heldAnswer = String\(session\.lastAssistantSuggestion[\s\S]{0,500}if \(!heldAnswer\) output\.textContent/, 'A correct answer must remain visible while the next turn is being processed');

console.log('Recording regression checks passed');
