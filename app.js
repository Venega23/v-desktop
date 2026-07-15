const STORAGE_KEY = 'sloy.cards.v1';
const SPACES_KEY = 'sloy.spaces.v2';
const ACTIVE_SPACE_KEY = 'sloy.active-space.v2';
let spacesStorageWritesBlocked = false;
let pendingStorageNotice = '';
let storageNoticeTimer = null;

function showStorageNotice(message) {
  if (!pendingStorageNotice.includes(message)) pendingStorageNotice = [pendingStorageNotice, message].filter(Boolean).join(' ');
  if (storageNoticeTimer) return;
  storageNoticeTimer = setTimeout(() => {
    storageNoticeTimer = null;
    const notice = pendingStorageNotice;
    pendingStorageNotice = '';
    try { showToast(notice, { duration:7000 }); }
    catch { try { window.alert(notice); } catch {} }
  }, 0);
}

function storageFailureMessage(error) {
  const quotaExceeded = error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014;
  return quotaExceeded
    ? 'Не удалось сохранить изменения: хранилище приложения переполнено. Освободите место и повторите попытку.'
    : 'Не удалось сохранить изменения: локальное хранилище недоступно. Данные в текущем окне ещё не записаны.';
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); }
  catch (error) {
    console.error(`Storage read failed for ${key}`, error);
    showStorageNotice('Не удалось прочитать локальные данные приложения. Проверьте доступ к хранилищу.');
    return null;
  }
}

function safeStorageSet(key, value) {
  if (key === SPACES_KEY && spacesStorageWritesBlocked) {
    showStorageNotice('Исходные данные пространств повреждены и пока не перезаписаны: не удалось создать recovery-копию.');
    return false;
  }
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch (error) {
    console.error(`Storage write failed for ${key}`, error);
    showStorageNotice(storageFailureMessage(error));
    return false;
  }
}

function safeJsonStorageSet(key, value) {
  try { return safeStorageSet(key, JSON.stringify(value)); }
  catch (error) {
    console.error(`Storage serialization failed for ${key}`, error);
    showStorageNotice('Не удалось подготовить изменения к сохранению. Данные в текущем окне ещё не записаны.');
    return false;
  }
}

const seedCards = [
  {
    id: 'opening-script', type: 'text', size: 'large', accent: '#818cf8', kicker: 'Скрипт',
    title: 'Відкриття дзвінка',
    content: '<p><strong>«Доброго дня! Мене звати Володимир. Ви раніше цікавилися вивченням англійської мови — пригадуєте?»</strong></p><p class="note-quote">«Та, можливо це було давніше…»</p><p><strong>↓ Виявлення:</strong></p><p>«Вже займаєтесь / навчаєтесь чи немає часу?»</p><p class="note-quote">«Приємно спілкуватися з людиною, яка розуміє важливість англійської!»</p><p><strong>↓ Ціль / мета:</strong></p><p>«Для чого вам потрібна англійська?»</p><p class="note-quote">«Ми тому і називаємося АнтиШколою…»</p><p><strong>↓ Біль:</strong></p><p>«Чого вам зараз не вистачає у вивченні?»</p>'
  },
  {
    id: 'algo', type: 'text', size: 'medium', accent: '#818cf8', kicker: '4 кроки',
    title: 'Алгоритм заперечень',
    content: '<p><strong>1. Приєднання</strong> — «Розумію вас»</p><p><strong>2. Уточнення</strong> — «Що саме бентежить?»</p><p><strong>3. Аргумент</strong> — під конкретну потребу</p><p><strong>4. Питання-заклик</strong> — «Сьогодні чи завтра?»</p>'
  },
  {
    id: 'false-obj', type: 'text', size: 'small', accent: '#fbbf24', kicker: 'Хибні',
    title: '«Не цікаво / Не актуально»',
    content: '<p>Хибне! Виводимо на справжнє:</p><p class="note-quote">«Вже займаєтесь чи просто немає часу?»</p>'
  },
  {
    id: 'already-studying', type: 'checklist', size: 'medium', accent: '#2dd4bf', kicker: 'Сценарій',
    title: '«Вже займаюся»',
    items: [
      { text: 'Приєднання: «Круто, що розвиваєтесь!»', checked: false },
      { text: 'У якому форматі займаєтесь?', checked: false },
      { text: 'Як давно? Якого рівня вже?', checked: false },
      { text: 'Чого не вистачає? Яка мета?', checked: false },
      { text: 'Аргумент: «50-70% уроку говорите»', checked: false },
      { text: 'Заклик: «Сьогодні чи завтра?»', checked: false }
    ]
  },
  {
    id: 'no-time', type: 'text', size: 'small', accent: '#60a5fa', kicker: 'Сценарій',
    title: '«Немає часу»',
    content: '<p>«Розумію — часу завжди не вистачає»</p><p class="note-quote">«Ми підлаштовуємось під вас, а не ви під нас»</p>'
  },
  {
    id: 'expensive', type: 'text', size: 'wide', accent: '#fb7185', kicker: 'Сценарій',
    title: '«Дорого»',
    content: '<p><strong>Приєднання:</strong> «Фінансове питання важливе»</p><p><strong>Уточнення:</strong> «З чим порівнюєте?»</p><p>vs Групи → «Весь урок тільки ваш»</p><p>vs Репетитор → «ДЗ авто, 50-70% говоріння»</p>'
  },
  {
    id: 'think', type: 'text', size: 'small', accent: '#a78bfa', kicker: 'Сценарій',
    title: '«Подумаю / Сайт»',
    content: '<p>«Сайт поверхневий. Краще пробний — живе враження»</p><p class="note-quote">«Першій чи другій половині дня зручніше?»</p>'
  },
  {
    id: 'advantages', type: 'text', size: 'medium', accent: '#fbbf24', kicker: 'Аргументи',
    title: 'Переваги школи',
    content: '<p>🥇 <strong>№1</strong> в рейтингу шкіл 2025</p><p>⭐ Рейтинг <strong>9.5</strong> — 9 років поспіль</p><p>🌍 Носії мови (з рівня B2)</p><p>🎯 Студент говорить <strong>50-70%</strong> уроку</p><p>🔄 Не ви під нас, а ми під вас</p><p>📜 Держліцензія + сертифікат рівня</p>'
  },
  {
    id: 'call-action', type: 'text', size: 'small', accent: '#2dd4bf', kicker: 'Заклики',
    title: 'Питання-заклики',
    content: '<p>«Сьогодні чи завтра?»</p><p>«Першій чи другій половині?»</p><p>«Яка година підходить?»</p><p>«Підберемо прямо зараз?»</p>'
  },
  {
    id: 'call-chain', type: 'checklist', size: 'large', accent: '#818cf8', kicker: 'Дзвінок',
    title: 'Ланцюжок дзвінка',
    items: [
      { text: 'Привітання + зручно говорити?', checked: false },
      { text: 'Виявити заперечення (якщо є)', checked: false },
      { text: 'Приєднання + Уточнення', checked: false },
      { text: 'Аргумент (під конкретну потребу)', checked: false },
      { text: 'Назвати ціну (від 650 грн/урок)', checked: false },
      { text: 'К-сть уроків на тиждень?', checked: false },
      { text: 'Реферальна програма', checked: false },
      { text: 'Питання-заклик → дата ПУ', checked: false },
      { text: "Зафіксувати ім'я + контакт", checked: false },
      { text: 'Підсумок + закрити розмову', checked: false }
    ]
  },
  {
    id: 'crm-rules', type: 'text', size: 'medium', accent: '#f87171', kicker: 'CRM',
    title: 'Правило 3 контактів',
    content: '<p><strong>1-й недозвін:</strong> → НДЗ → завтра</p><p><strong>2-й недозвін:</strong> → НДЗ → +день</p><p><strong>3-й:</strong> Закрито нереалізовано → Хронічний недозвін</p><p><strong>«Не цікаво» / скид:</strong> → Виявити потребу → «Скид» → 3 дні</p>'
  }
];

function antischoolContentMarkup(value = '') {
  return String(value).trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n').map(line => escapeHtml(line));
    return `<p>${lines.join('<br>')}</p>`;
  }).join('');
}

function createAntischoolCards() {
  const source = Array.isArray(window.ANTISCHOOL_CONTENT) ? window.ANTISCHOOL_CONTENT : [];
  const createdAt = Date.now();
  return source.map((item, index) => ({
    id:`antischool-${item.id}`,
    type:item.type || 'text',
    size:item.size || 'medium',
    accent:item.accent || '#7c6ff0',
    kicker:item.kicker || item.category || 'АнтиШкола',
    title:item.title,
    content:item.type === 'checklist' ? '' : antischoolContentMarkup(item.text),
    ...(item.type === 'checklist' ? { items:(item.items || []).map(text => ({ text, checked:false })) } : {}),
    knowledgeText:item.text,
    knowledgeCategory:item.category,
    antischoolVersion:3,
    createdAt:createdAt - index
  }));
}

const bundledAntischoolCards = createAntischoolCards();
if (bundledAntischoolCards.length === 20) seedCards.splice(0, seedCards.length, ...bundledAntischoolCards);

function cardSequenceNumber(card) {
  for (const value of [card?.kicker, card?.title]) {
    const match = String(value || '').match(/^\s*(\d{1,4})(?=$|\s|[·.\-:])/);
    if (match) return Number(match[1]);
  }
  return null;
}

function cardsInNumberOrder(sourceCards) {
  return sourceCards.map((card, index) => ({ card, index, number:cardSequenceNumber(card) }))
    .sort((a, b) => {
      if (a.number === null && b.number === null) return a.index - b.index;
      if (a.number === null) return 1;
      if (b.number === null) return -1;
      return a.number - b.number || a.index - b.index;
    })
    .map(item => item.card);
}

let workspaces = loadWorkspaces();

// Replace the prototype Antischool board once, while preserving saved meetings.
(function migrateAntischoolBoardV3() {
  const migrationKey = 'sloy.antischool-board.v3';
  if (safeStorageGet(migrationKey) === '1' || bundledAntischoolCards.length !== 20) return;
  const workSpace = workspaces.find(space => /анти\s*школ/i.test(String(space.title || '')))
    || workspaces.find(space => space.id === 'work');
  if (!workSpace) return;

  const savedMeetings = (workSpace.cards || []).filter(card => card.type === 'transcript');
  workSpace.title = 'Антишкола';
  workSpace.glyph = 'АШ';
  workSpace.view = { layout:'gallery', sort:'manual' };
  workSpace.cards = [...structuredClone(bundledAntischoolCards), ...savedMeetings];
  workSpace.injected_20_cards = 3;

  const knowledge = workspaceKnowledge(workSpace);
  knowledge.items = knowledge.items.filter(item => item.source !== 'antischool-board');
  const grouped = new Map();
  window.ANTISCHOOL_CONTENT.forEach(item => {
    const category = item.category || 'АнтиШкола';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(`${item.title}\n${item.text}`);
  });
  const now = Date.now();
  [...grouped.entries()].forEach(([title, texts], index) => knowledge.items.push({
    id:`antischool-knowledge-${index + 1}`,
    type:'text', title:`АнтиШкола · ${title}`, text:texts.join('\n\n'),
    createdAt:now - index, source:'antischool-board', imported:true
  }));
  knowledge.summary = 'База АнтиШколи: сценарії дзвінка й опрацювання заперечень, переваги школи, актуальний прайс, формати навчання та спеціальні курси.';
  knowledge.facts = dedupeStrings([
    ...(knowledge.facts || []),
    'АнтиШкола заснована у 2015 році в Харкові.',
    '60 000+ студентів навчалося, 12 000+ навчається онлайн зараз.',
    '1 000+ викладачів з усього світу та 20+ предметів.',
    'Індивідуальний урок триває 50 хвилин; студент говорить 50–70% уроку.',
    'Базова ціна пакета з 6 індивідуальних уроків — 3 899 грн, або 650 грн за урок.',
    'Пробний урок потрібно завершувати конкретним вибором дати й часу.'
  ]);
  knowledge.tags = dedupeStrings([...(knowledge.tags || []), 'АнтиШкола', 'продажі', 'заперечення', 'ціни', 'курси', 'пробний урок']);
  knowledge.playbook = dedupeObjects([
    ...(knowledge.playbook || []),
    { cue:'Не цікаво / не актуально', response:'Уточнити: клієнт уже десь займається чи просто не має часу; перейти до справжнього заперечення.' },
    { cue:'Вже займаюся', response:'З’ясувати формат, строк, мету й нестачу практики; аргументувати 50–70% говоріння та запропонувати пробний.' },
    { cue:'Немає часу', response:'Наголосити на гнучкому графіку, включно з вихідними, і запропонувати вибір: сьогодні чи завтра.' },
    { cue:'Дорого', response:'Запитати, з чим порівнюють; порівняти персональний час із групою, репетитором або самонавчанням; запропонувати пробний.' },
    { cue:'Подумаю / подивлюся сайт', response:'Уточнити, якої інформації бракує; пояснити цінність живого пробного й запропонувати половину дня.' },
    { cue:'Закриття розмови', response:'Поставити питання-заклик, зафіксувати дату пробного, ім’я та контакт, підсумувати домовленість.' }
  ], item => `${item.cue} ${item.response}`);
  knowledge.revision = Number(knowledge.revision || 0) + 1;

  const saved = safeJsonStorageSet(SPACES_KEY, workspaces);
  if (saved) safeStorageSet(migrationKey, '1');
})();

// Restore the intended 01 → 20 reading order without replacing edited card content.
(function sortAntischoolBoardV4() {
  const migrationKey = 'sloy.antischool-board.v4-number-order';
  if (safeStorageGet(migrationKey) === '1') return;
  const workSpace = workspaces.find(space => /анти\s*школ/i.test(String(space.title || '')));
  if (!workSpace || (workSpace.cards || []).filter(card => cardSequenceNumber(card) !== null).length < 20) return;
  workSpace.cards = cardsInNumberOrder(workSpace.cards || []);
  workSpace.view ||= { layout:'gallery', sort:'manual' };
  workSpace.view.sort = 'manual';
  const saved = safeJsonStorageSet(SPACES_KEY, workspaces);
  if (saved) safeStorageSet(migrationKey, '1');
})();

// Consolidate prototype-era auxiliary cards into their single conversation hub.
(function consolidateGeneratedMeetingCards() {
  let changed = false;
  workspaces.forEach(space => {
    const removable = new Set();
    space.cards.forEach(card => {
      if (!card.liveSessionId || !['AI · важное','AI · ответ'].includes(card.kicker)) return;
      const hub = space.cards.find(candidate => candidate.id === card.liveSessionId && candidate.type === 'transcript');
      if (!hub) return;
      if (card.kicker === 'AI · ответ' && !hub.suggestedAnswer) hub.suggestedAnswer = String(card.content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      if (card.kicker === 'AI · важное' && !hub.legacyImportant) hub.legacyImportant = String(card.content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      removable.add(card.id);
      changed = true;
    });
    if (removable.size) space.cards = space.cards.filter(card => !removable.has(card.id));
  });
  if (changed) safeJsonStorageSet(SPACES_KEY, workspaces);
})();

(function migrateExplicitMeetingLanguages() {
  let changed = false;
  let preferred = 'uk';
  try {
    const stored = JSON.parse(safeStorageGet('sloy.ai-settings') || '{}');
    if (['uk','ru','en'].includes(stored.transcriptionLanguage)) preferred = stored.transcriptionLanguage;
  } catch {}
  workspaces.forEach(space => space.cards.forEach(card => {
    if (card.meetingVersion && !['uk','ru','en'].includes(card.meetingLanguage)) { card.meetingLanguage = preferred; changed = true; }
  }));
  if (changed) safeJsonStorageSet(SPACES_KEY, workspaces);
})();

(function migrateOrphanAiCardsIntoKnowledge() {
  const migrationKey = 'sloy.generated-cards-to-knowledge.v1';
  if (safeStorageGet(migrationKey)) return;
  let changed = false;
  workspaces.forEach(space => {
    const generated = space.cards.filter(card => card.type === 'text' && ['AI · важное','AI · ответ'].includes(card.kicker));
    if (!generated.length) return;
    space.knowledge ||= { items:[], summary:'', facts:[], tags:[], playbook:[], revision:0 };
    generated.forEach(card => {
      const text = String(card.content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !space.knowledge.items.some(item => item.sourceCardId === card.id)) space.knowledge.items.push({ id:crypto.randomUUID(), type:'text', title:card.title || card.kicker, text, createdAt:card.createdAt || Date.now(), sourceCardId:card.id, imported:true });
    });
    const ids = new Set(generated.map(card => card.id));
    space.cards = space.cards.filter(card => !ids.has(card.id));
    space.knowledge.revision = Number(space.knowledge.revision || 0) + 1;
    changed = true;
  });
  const migrated = !changed || safeJsonStorageSet(SPACES_KEY, workspaces);
  if (migrated) safeStorageSet(migrationKey, '1');
})();

// ── Cleanup: reset cards stuck in active/pausing state from previous crash ──
(function cleanupStuckMeetingState() {
  let changed = false;
  workspaces.forEach(space => {
    space.cards.forEach(card => {
      if (card.type === 'transcript' && (card.meetingState === 'active' || card.meetingState === 'pausing')) {
        card.meetingState = 'paused';
        card.live = false;
        card.processing = card.processing === 'saving' || card.processing === 'live:connecting' || card.processing === 'live:listening' ? '' : card.processing;
        changed = true;
      }
    });
    // also clean orphan activeMeetingId
    if (space.activeMeetingId) {
      const meeting = space.cards.find(c => c.id === space.activeMeetingId && c.type === 'transcript' && c.meetingState !== 'finalized');
      if (!meeting) { delete space.activeMeetingId; changed = true; }
    }
  });
  if (changed) safeJsonStorageSet(SPACES_KEY, workspaces);
})();

let activeSpaceId = safeStorageGet(ACTIVE_SPACE_KEY) || workspaces[0].id;
if (!workspaces.some(space => space.id === activeSpaceId)) activeSpaceId = workspaces[0].id;
let cards = activeSpace().cards;
let editMode = false;
let draggedId = null;
let mediaRecorder = null;
let mediaStream = null;
let recordingSourceStreams = [];
let recordingAudioContext = null;
let separateRecordings = [];
let liveSttSessionId = null;
let liveCaptureNodes = [];
let liveStopPromise = Promise.resolve();
let liveProvider = '';
let liveHasSystemSource = false;
let liveLanguage = 'auto';
let groqLiveInterval = null;
const groqLiveBuffers = { mic:[], system:[] };
const groqLiveBusy = { mic:false, system:false };
const liveInterim = { mic:'', system:'' };
const liveLastFinal = { mic:'', system:'' };
const liveLastFinalAt = { mic:0, system:0 };
const liveSuggestionTurns = { mic:[], system:[] };
let audioChunks = [];
let speechRecognition = null;
let transcriptText = '';
let liveUtterances = [];
let recordStartedAt = 0;
let recordTimer = null;
let recordingSpaceId = null;
let editingImageId = null;
let editingLinkId = null;
let recordingFinishing = false;
let recordingSession = null;
let recordingStarting = false;
let suggestionInFlight = false;
let suggestionTimer = null;
let lastSuggestedQuestion = '';
let lastSuggestedAt = 0;
let pendingSuggestionQuestion = '';
let suggestionCandidate = null;
let suggestionCandidateRevision = 0;
const suggestionGate = window.SloyRecordingRuntime.createLatestRequestGate(ticket => window.sloy?.cancelXaiSuggest?.(ticket.id));
let answerSearchPaused = false;
let answerPauseRevision = 0;
let speechRestartTimer = null;
let speechRestartAttempts = 0;
let liveCardRenderTimer = null;
let liveStructureInFlight = false;
let lastLiveStructureAt = 0;
let lastLiveStructureLength = 0;
const selectedIds = new Set();
const deletedCardHistory = [];
const MAX_DELETED_CARD_HISTORY = 30;
const cardUndoHistory = [];
const MAX_CARD_UNDO_HISTORY = 60;
let imageZoomPreview = null;
const meetingTabs = new Map();
const aiProgressOperations = new Map();
const aiProgressCards = new Map();
let aiProgressRenderTimer = null;

const board = document.querySelector('#board');
const search = document.querySelector('#search');
const addMenu = document.querySelector('#add-menu');
const imageInput = document.querySelector('#image-input');
const toast = document.querySelector('#toast');
const recordPanel = document.querySelector('#record-panel');
if (window.sloy?.isDesktop) document.body.classList.add('desktop-shell');
const recordButton = document.querySelector('#record-button');
const coachButton = document.querySelector('#coach-button');
const spaceDialog = document.querySelector('#space-dialog');
const knowledgeDialog = document.getElementById('knowledge-dialog');
const knowledgeFeed = document.getElementById('knowledge-feed');
const knowledgeInput = document.getElementById('knowledge-input');
const knowledgeImageInput = document.getElementById('knowledge-image-input');
const spaceChatFeed = document.getElementById('space-chat-feed');
const spaceChatInput = document.getElementById('space-chat-input');
let knowledgeHubTab = 'chat';
let spaceChatBusy = false;
let spaceChatBusySpaceId = '';
const recordingPreflightDialog = document.getElementById('recording-preflight-dialog');
let recordingPreflightPromise = null;
let resolveRecordingPreflight = null;

function captureCardLayoutState(space = activeSpace()) {
  return {
    order:(space.cards || []).map(card => card.id),
    view:{ layout:space.view?.layout || 'dashboard', sort:space.view?.sort || 'manual' },
    cards:Object.fromEntries((space.cards || []).map(card => [card.id, {
      position:card.position ? { ...card.position } : null,
      flowColumns:Number.isFinite(Number(card.flowColumns)) ? Number(card.flowColumns) : null,
      flowRows:Number.isFinite(Number(card.flowRows)) ? Number(card.flowRows) : null,
      flowHeight:Number.isFinite(Number(card.flowHeight)) ? Number(card.flowHeight) : null,
      flowOffsetX:Number.isFinite(Number(card.flowOffsetX)) ? Number(card.flowOffsetX) : null,
      flowOffsetY:Number.isFinite(Number(card.flowOffsetY)) ? Number(card.flowOffsetY) : null,
      flowLayer:Number.isFinite(Number(card.flowLayer)) ? Number(card.flowLayer) : null
    }]))
  };
}

function pushCardUndo(entry) {
  cardUndoHistory.push({ at:Date.now(), ...entry });
  if (cardUndoHistory.length > MAX_CARD_UNDO_HISTORY) cardUndoHistory.shift();
}

function pushCardLayoutUndo(label, state = captureCardLayoutState()) {
  pushCardUndo({ type:'layout', label, spaceId:activeSpace().id, state });
}

function restoreCardLayoutState(entry) {
  const space = workspaces.find(item => item.id === entry.spaceId);
  if (!space || !entry.state) return false;
  const byId = new Map(space.cards.map(card => [card.id, card]));
  const ordered = entry.state.order.map(id => byId.get(id)).filter(Boolean);
  const known = new Set(ordered.map(card => card.id));
  ordered.push(...space.cards.filter(card => !known.has(card.id)));
  space.cards.splice(0, space.cards.length, ...ordered);
  for (const card of space.cards) {
    const saved = entry.state.cards[card.id];
    if (!saved) continue;
    if (saved.position) card.position = { ...saved.position }; else delete card.position;
    for (const field of ['flowColumns','flowRows','flowHeight','flowOffsetX','flowOffsetY','flowLayer']) {
      if (saved[field] === null) delete card[field]; else card[field] = saved[field];
    }
  }
  space.view = { ...space.view, ...entry.state.view };
  if (space.id === activeSpaceId) cards = space.cards;
  selectedIds.clear();
  persistWorkspaces();
  renderSpaces();
  if (space.id === activeSpaceId) render();
  showToast(`Отменено: ${entry.label || 'действие'}`);
  return true;
}

function undoLastCardAction() {
  resetImageZoomPreview();
  for (let index = cardUndoHistory.length - 1; index >= 0; index--) {
    const entry = cardUndoHistory[index];
    const belongsHere = entry.type === 'move-space'
      ? entry.sourceSpaceId === activeSpace().id || entry.targetSpaceId === activeSpace().id
      : entry.spaceId === activeSpace().id;
    if (!belongsHere) continue;
    cardUndoHistory.splice(index, 1);
    if (entry.type === 'delete') return restoreDeletedCard(entry.deletedEntry);
    if (entry.type === 'move-space') return restoreCrossSpaceMove(entry);
    return restoreCardLayoutState(entry);
  }
  return false;
}

function isCardUndoShortcut(event) {
  return Boolean((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.code === 'KeyZ' || String(event.key || '').toLowerCase() === 'z'));
}

function beginCardAiProgress(card, label) {
  const operationId = crypto.randomUUID();
  const progress = { operationId, cardId:card.id, label, message:label, phase:'starting', current:0, total:0 };
  aiProgressOperations.set(operationId, progress);
  aiProgressCards.set(card.id, progress);
  return operationId;
}

function endCardAiProgress(operationId) {
  const progress = aiProgressOperations.get(operationId);
  aiProgressOperations.delete(operationId);
  if (progress && aiProgressCards.get(progress.cardId)?.operationId === operationId) aiProgressCards.delete(progress.cardId);
  clearTimeout(aiProgressRenderTimer);
  aiProgressRenderTimer = setTimeout(() => render(), 60);
}

window.sloy?.onAiProgress?.(event => {
  const progress = aiProgressOperations.get(event?.operationId);
  if (!progress) return;
  Object.assign(progress, {
    phase:String(event.phase || progress.phase),
    message:String(event.message || progress.message),
    current:Math.max(0, Number(event.current) || 0),
    total:Math.max(0, Number(event.total) || 0)
  });
  clearTimeout(aiProgressRenderTimer);
  aiProgressRenderTimer = setTimeout(() => render(), 60);
});

function loadAiSettings() {
  try {
    const stored = JSON.parse(safeStorageGet('sloy.ai-settings') || '{}');
    if (!safeStorageGet('sloy.system-audio-v3')) {
      if (typeof stored.captureSystemAudio !== 'boolean') stored.captureSystemAudio = false;
      safeStorageSet('sloy.system-audio-v3', '1');
      safeJsonStorageSet('sloy.ai-settings', stored);
    }
    const settings = { captureSystemAudio:false, autoTranscribe:true, liveTranscription:true, liveSuggestions:true, internetSearch:false, autoStructure:true, transcriptionLanguage:'uk', ...stored };
    if (!['uk','ru','en'].includes(settings.transcriptionLanguage)) {
      settings.transcriptionLanguage = 'uk';
      safeJsonStorageSet('sloy.ai-settings', settings);
    }
    return settings;
  }
  catch { return { captureSystemAudio:false, autoTranscribe:true, liveTranscription:true, liveSuggestions:true, internetSearch:false, autoStructure:true, transcriptionLanguage:'uk' }; }
}

function resetSuggestionPipeline({ resetLast = false } = {}) {
  suggestionGate.invalidate();
  suggestionCandidateRevision += 1;
  clearTimeout(suggestionTimer);
  suggestionTimer = null;
  suggestionCandidate = null;
  pendingSuggestionQuestion = '';
  suggestionInFlight = false;
  if (resetLast) {
    lastSuggestedQuestion = '';
    lastSuggestedAt = 0;
  }
}

function liveSuggestionsEnabled() {
  return Boolean(recordingSession?.coachOnly || loadAiSettings().liveSuggestions);
}

function resetLiveSuggestionTurns() {
  liveSuggestionTurns.mic = [];
  liveSuggestionTurns.system = [];
  liveLastFinalAt.mic = liveLastFinalAt.system = 0;
}

function collectLiveSuggestionPart(source, value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const parts = liveSuggestionTurns[source] || (liveSuggestionTurns[source] = []);
  const previous = String(parts.at(-1) || '');
  const previousNormalized = normalizedPhrase(previous);
  const nextNormalized = normalizedPhrase(text);
  if (!previousNormalized) parts.push(text);
  else if (nextNormalized === previousNormalized) return;
  else if (nextNormalized.includes(previousNormalized)) parts[parts.length - 1] = text;
  else if (!previousNormalized.includes(nextNormalized)) parts.push(text);
  while (parts.join(' ').length > 2200 && parts.length > 1) parts.shift();
}

function commitLiveSuggestionTurn(source, fallback = '') {
  const parts = liveSuggestionTurns[source] || [];
  const text = (parts.length ? parts.join(' ') : String(fallback || '')).replace(/\s+/g, ' ').trim().slice(-2000);
  liveSuggestionTurns[source] = [];
  return text;
}

function ingestLiveSuggestionBoundary(event, source) {
  if (!event?.isFinal) return '';
  const clean = String(event.text || '').replace(/\s+/g, ' ').trim();
  if (clean) collectLiveSuggestionPart(source, clean);
  return event.speechFinal ? commitLiveSuggestionTurn(source, clean) : '';
}

function normalizedPhrase(value) {
  return String(value || '').toLocaleLowerCase().replace(/\[(вы|собеседник)\]/gi, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function phraseSimilarity(left, right) {
  const a = normalizedPhrase(left);
  const b = normalizedPhrase(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) > 18 && (a.includes(b) || b.includes(a))) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aTokens = new Set(a.split(' ').filter(token => token.length > 2));
  const bTokens = new Set(b.split(' ').filter(token => token.length > 2));
  if (!aTokens.size || !bTokens.size) return 0;
  const common = [...aTokens].filter(token => bTokens.has(token)).length;
  return common / Math.min(aTokens.size, bTokens.size);
}

function dedupeStrings(values = []) {
  const result = [];
  values.filter(Boolean).forEach(value => {
    const text = typeof value === 'string' ? value.trim() : value;
    const comparable = typeof text === 'string' ? text : JSON.stringify(text);
    const duplicateIndex = result.findIndex(existing => phraseSimilarity(typeof existing === 'string' ? existing : JSON.stringify(existing), comparable) >= .72);
    if (duplicateIndex < 0) result.push(text);
    else if (comparable.length > String(typeof result[duplicateIndex] === 'string' ? result[duplicateIndex] : JSON.stringify(result[duplicateIndex])).length) result[duplicateIndex] = text;
  });
  return result;
}

function dedupeObjects(values = [], keySelector) {
  const result = [];
  values.filter(Boolean).forEach(value => {
    const key = keySelector(value);
    const duplicateIndex = result.findIndex(existing => phraseSimilarity(keySelector(existing), key) >= .72);
    if (duplicateIndex < 0) result.push(value);
    else if (String(key).length > String(keySelector(result[duplicateIndex])).length) result[duplicateIndex] = value;
  });
  return result;
}

function recapText(value, preferredKeys = []) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value !== 'object') return '';
  const keys = [...preferredKeys, 'text', 'title', 'question', 'summary', 'name', 'term', 'meaning', 'cue', 'response'];
  for (const key of keys) {
    if (value[key] === value) continue;
    const text = recapText(value[key]);
    if (text) return text;
  }
  return '';
}

function recapList(values, preferredKeys = []) {
  const list = Array.isArray(values) ? values : values === null || values === undefined ? [] : [values];
  return dedupeStrings(list.map(value => recapText(value, preferredKeys)).filter(Boolean));
}

function sanitizeRecap(recap) {
  if (!recap) return recap;
  if (typeof recap !== 'object') recap = { summary:recap };
  const topics = (Array.isArray(recap.topics) ? recap.topics : []).map(topic => ({
    ...(topic && typeof topic === 'object' ? topic : {}),
    title:recapText(topic, ['title', 'topic', 'name']),
    summary:recapText(topic?.summary ?? topic?.description)
  })).filter(topic => topic.title);
  const tasks = (Array.isArray(recap.tasks) ? recap.tasks : []).map(task => ({
    ...(task && typeof task === 'object' ? task : {}),
    title:recapText(task, ['title', 'task', 'text']),
    owner:recapText(task?.owner, ['name']) || null,
    due:recapText(task?.due, ['date', 'deadline']) || null
  })).filter(task => task.title);
  let playbook = (Array.isArray(recap.playbook) ? recap.playbook : []).map(item => ({
    ...(item && typeof item === 'object' ? item : {}),
    cue:recapText(item?.cue ?? item?.question, ['question', 'title']),
    response:recapText(item?.response ?? item?.answer, ['answer', 'text'])
  })).filter(item => item.cue || item.response);
  if (!playbook.length) {
    playbook = topics.filter(topic => topic.summary).map(topic => ({ cue:topic.title, response:topic.summary }));
  }
  return {
    ...recap,
    summary:dedupeTranscriptText(recapText(recap.summary)).replace(/\n/g, ' '),
    keyPoints:recapList(recap.keyPoints, ['point', 'title']),
    decisions:recapList(recap.decisions, ['decision', 'title']),
    questions:recapList(recap.questions, ['question', 'title']),
    tasks:dedupeObjects(tasks, task => task.title),
    topics:dedupeObjects(topics, topic => topic.title),
    playbook:dedupeObjects(playbook, item => `${item.cue} ${item.response}`)
  };
}

function mergeStructuredRecap(card, recap) {
  const current = sanitizeRecap(card?.structured);
  const next = sanitizeRecap(recap);
  if (!next) return current;
  next.keyPoints = dedupeStrings([...(current?.keyPoints || []), ...(next.keyPoints || [])]);
  next.decisions = dedupeStrings([...(current?.decisions || []), ...(next.decisions || [])]);
  next.questions = dedupeStrings([...(current?.questions || []), ...(next.questions || [])]);
  next.tasks = dedupeObjects([...(current?.tasks || []), ...(next.tasks || [])], item => item.title);
  next.topics = dedupeObjects([...(current?.topics || []), ...(next.topics || [])], item => item.title);
  next.playbook = dedupeObjects([...(next.playbook || []), ...(current?.playbook || [])], item => `${item.cue} ${item.response}`);
  return next;
}

function appendPlaybookEntry(card, cue, response) {
  if (!card) return;
  const structured = sanitizeRecap(card.structured || { summary:'', keyPoints:[], decisions:[], questions:[], tasks:[], topics:[], playbook:[] });
  structured.playbook = dedupeObjects([...structured.playbook, { cue:recapText(cue), response:recapText(response) }].filter(item => item.cue && item.response), item => `${item.cue} ${item.response}`);
  card.structured = structured;
  card.structuredSource = 'ai';
}

function liveUtteranceLabel(item) {
  if (item.kind === 'assistant-readback') return 'Вы · озвучиваете подсказку';
  if (item.source === 'system') return item.speaker ? `Собеседник ${item.speaker}` : 'Собеседник';
  if (!item.speaker) return liveHasSystemSource ? 'Вы' : 'Микрофон';
  if (recordingSession?.userSpeakerId) return item.speaker === recordingSession.userSpeakerId ? 'Вы' : `Собеседник ${item.speaker}`;
  return `Участник ${item.speaker}`;
}

function syncUserSpeakerControl() {
  const holder = document.getElementById('record-speaker-role');
  const select = document.getElementById('record-user-speaker');
  if (!holder || !select || !recordingSession) return;
  const coachOnly = Boolean(recordingSession.coachOnly);
  const caption = holder.querySelector('span');
  if (caption) caption.textContent = coachOnly ? 'Кто спрашивает AI' : 'Мой голос';
  const speakers = [...new Set(liveUtterances.filter(item => item.source === 'mic' && item.speaker).map(item => item.speaker))];
  holder.hidden = liveHasSystemSource || !speakers.length;
  const selected = recordingSession.userSpeakerId || '';
  select.innerHTML = `<option value="">${coachOnly ? 'Все голоса' : 'Авто'}</option>${speakers.map((speaker,index) => `<option value="${escapeAttr(speaker)}">Участник ${index + 1}</option>`).join('')}`;
  select.value = speakers.includes(selected) ? selected : '';
}

function rebuildTranscriptFromUtterances() {
  transcriptText = liveUtterances.map(item => `[${liveUtteranceLabel(item)}] ${item.text}`).join('\n');
}

function appendLiveUtterance(source, value, speaker = '') {
  const text = String(value || '').trim();
  if (!text) return false;
  const now = Date.now();
  const recent = liveUtterances.filter(item => now - item.at < 8000).slice(-12);
  const duplicate = recent.find(item => item.source === source && phraseSimilarity(item.text, text) >= .84);
  if (duplicate) {
    if (text.length > duplicate.text.length * 1.18) { duplicate.text = text; rebuildTranscriptFromUtterances(); }
    return false;
  }
  const echo = recent.find(item => item.source !== source && now - item.at < 2500 && phraseSimilarity(item.text, text) >= .9);
  if (echo) {
    if (source === 'system' && echo.source === 'mic') { echo.source = 'system'; echo.text = text; rebuildTranscriptFromUtterances(); }
    return false;
  }
  liveUtterances.push({ id:crypto.randomUUID(), source, speaker:String(speaker || ''), text, at:now });
  rebuildTranscriptFromUtterances();
  syncUserSpeakerControl();
  return true;
}

function dedupeTranscriptText(value) {
  return dedupeStrings(String(value || '').split(/(?<=[.!?])\s+|\n+/).map(part => part.trim()).filter(Boolean)).join('\n');
}

function loadCards() {
  try {
    const saved = JSON.parse(safeStorageGet(STORAGE_KEY));
    return Array.isArray(saved) && saved.length ? saved : structuredClone(seedCards);
  } catch { return structuredClone(seedCards); }
}

function loadWorkspaces() {
  const raw = safeStorageGet(SPACES_KEY);
  if (raw !== null) {
    try {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length) {
        const asIdx = saved.findIndex(s => s.title && s.title.includes('Антишкола'));
        // Legacy v2 injection is intentionally disabled; the versioned board migration below owns this update.
        if (false && asIdx !== -1 && saved[asIdx].injected_20_cards !== 2) {
          try {
            const rawCards = [{"text":"4 КРОКИ — завжди однакові:<br>1. ПРИЄДНАННЯ → «Розумію вас» / «Гарне питання»<br>2. УТОЧНЕННЯ → «Що саме вас бентежить?» / «З чим порівнюєте?»<br>3. АРГУМЕНТ → відповідь під конкретну потребу (2-3 фрази)<br>4. ПИТАННЯ-ЗАКЛИК → «На який день зручніше — сьогодні чи завтра?»<br><br>Золоті правила:<br>- Кажи «і» замість «але»<br>- Ставити відкриті питання (що, де, як, чому?)<br>- Після аргументу — завжди питання-заклик<br>- Не монолог! Більше 2-3 фраз поспіль — стоп","title":"Алгоритм заперечень (4 кроки)"},{"text":"⚠️ Це ХИБНЕ заперечення — виводимо на справжнє!<br><br>Уточнення: «Підкажіть, вже займаєтесь десь? Чи просто немає часу?»<br>→ Перейти до відповідного сценарію залежно від відповіді","title":"«Не цікаво / Не актуально»"},{"text":"Приєднання: «Дуже круто, що розвиваєте англійську!»<br>Уточнення: «А в якому форматі? Як давно? Чого не вистачає? Яка мета?»<br>Аргумент: «Розумію. У нас студент говорить 50-70% уроку, без нудної граматики — лише реальні ситуації. Плюс ми №1 в рейтингу 2025 року»<br>Заклик: «Спробуйте й зробіть висновки самі — на який день зручніше, сьогодні чи завтра?»","title":"«Вже займаюся»"},{"text":"Приєднання: «Розумію — часу завжди не вистачає»<br>Аргумент: «Саме тому ми підлаштовуємось під вас — будь-який день і час, навіть вихідні»<br>Заклик: «Пропоную підібрати зручний час для пробного — сьогодні чи завтра?»","title":"«Немає часу»"},{"text":"Приєднання: «Згоден, фінансове питання важливе»<br>Уточнення: «З чим порівнюєте, якщо не секрет?»<br><br>vs Групи: «Там час ділиться на 5-10 людей. У нас — весь урок тільки ваш»<br>vs Репетитор: «У репетитора частина уроку — перевірка ДЗ. Ви говорите 50-70%»<br>vs Самонавчання: «Без системи бракує практики — у нас системно й ефективно»<br><br>Заклик: «Заплануємо пробний — і ви самі відчуєте різницю!»","title":"«Дорого»"},{"text":"Приєднання: «Розумію, рішення має бути обдуманим»<br>Уточнення: «А яка саме інформація цікавить?»<br>Аргумент: «Краще пробний — живе враження»<br>Заклик: «Перший чи другій половині дня зручніше?»<br>Якщо Ні: «За тиждень не вивчиш — заплануємо зараз?»","title":"«Подумаю / Сайт»"},{"text":"- №1 в рейтингу шкіл англійської 2025 (Ukrainian Business Award)<br>- Рейтинг 9.5 — 9 років поспіль<br>- Студент говорить 50-70% уроку (комунікативна методика)<br>- Носії мови (за ціною стандарту)<br>- Державна ліцензія + сертифікат рівня<br>- Гнучкий графік — ми під вас, не ви під нас<br>- Гарантія: не склав іспит → навчання безкоштовне до перескладання<br>- 60 000+ студентів, 12 000+ зараз навчається<br>- 20+ предметів, 1000+ викладачів з усього світу","title":"Переваги школи"},{"text":"[ ] Привітання + «Зручно говорити?»<br>[ ] Виявити заперечення (якщо є)<br>[ ] Приєднання + Уточнення<br>[ ] Аргумент (під конкретну потребу)<br>[ ] Навести ціну (від 650 грн/урок)<br>[ ] К-сть уроків на тиждень?<br>[ ] Реферальна програма<br>[ ] Питання-заклик → дата ПУ<br>[ ] Зафіксувати ім'я + контакт<br>[ ] Підсумок + закрити розмову","title":"Ланцюжок дзвінка (чекліст)"},{"text":"1-й недзвін: НДЗ → завтра<br>2-й недзвін: НДЗ → 1 день<br>3-й: Закрито нереалізовано → Хронічний недзвін<br><br>«Не цікаво» / скид: Виявити потребу → «Скид» → через 3 дні","title":"Правило 3 контактів"},{"text":"«Сьогодні чи завтра?»<br>«Перший чи другій половині дня?»<br>«Яка година підходить?»<br>«Підберемо прямо зараз, щоб зекономити ваш час?»<br>«Попробуєте — і самі порівняєте?»<br>«Заплануємо пробний і ви самі зробите висновки — коли зручно?»","title":"Питання-заклики (шаблони)"},{"text":"Блокування: «Це єдине, що вас зупиняє? Інших причин немає?»<br>Бумеранг: «Саме тому я і телефоную...»<br>Фрази-зв'язки: «Так, і водночас...» / «Так, проте з іншого боку...»<br>Уточнення: «Правильно розумію, що...?» / «Ви сказали, що...?»","title":"Аргументи (методи)"},{"text":"«Добрий день, мене звати [Ім'я], я ранiше цікавились вивченням англiйської мови?»<br>«В яких ви займаєтесь?»<br>«Чи можливо це вам зручніше говорити?»<br><br>Приємно спілкуватись з людиною яка розуміє важливість мови!<br>ціль/мета/для чого потрібна англ мова?<br>ми тому і навчаємось в антишколі!<br>чого вам зараз не вистачає у вивчанні?","title":"Привітання (скрипт)"},{"text":"6 уроків → 3 899 грн (650/урок)<br>12 уроків → 6 890 грн (574/урок, -12%)<br>24 уроки → 13 250 грн (552/урок, -15%)<br>36 уроків → 19 460 грн (541/урок, -17%)<br>48 уроків → 25 395 грн (529/урок, -19%)<br>64 уроки → 32 750 грн (512/урок, -21%)<br>72 уроки → 35 605 грн (495/урок, -24%)<br><br>Акція «2 дні» = додаткова знижка 5%<br><br>Розтермінування (без переплат):<br>36 ур → 11 683 грн × 2<br>48 ур → 14 880 грн × 2<br>72 ур → 21 565 грн × 2","title":"Ціни — Індивідуальний урок (50 хв)"},{"text":"Бустер (New) — дорослий:<br>Базовий: 6 міс → 999 грн<br>Стандарт: 12 міс → 2 399 грн<br>Преміум: 12 міс → 2 899 грн<br><br>Абонемент АНГЛ/МАТ (1-12 міс):<br>1 міс → 1 590 грн<br>2 міс → 2 860 грн (-10%)<br>4 міс → 5 090 грн (-20%)<br>8 міс → 9 540 грн (-25%)<br>12 міс → 13 360 грн (-30%)<br><br>Розтермінування абонементу:<br>4 міс → 2 545 × 2<br>8 міс → 4 770 × 2<br>12 міс → 6 680 × 2","title":"Бустер / Абонемент"},{"text":"Рік заснування: 2015, Харків<br>Студентів навчалось: 60 000+<br>Зараз навчається: 12 000+ онлайн<br>Викладачів: 1 000+ зі всього світу<br>Предметів: 20+<br>Середній термін: 2+ роки<br><br>Нагороди:<br>- ТОП-1 рейтингу шкіл англійської 2025<br>- Рейтинг 9.5 — 9 років поспіль<br>- «Вибір року» + «Найпрогресивніша освітня організація»<br>- Перша ліцензія позашкільної освіти онлайн в Україні<br><br>Девіз: «Готуємо до життя, а не до іспитів»","title":"АнтиШкола — Факти"},{"text":"Індивідуальний: 50 хв / 1 на 1 з викладачем<br>Груповий: 90 хв (менше 6 осіб = 75 хв)<br>Парний: 50 хв (пару шукають самостійно; рівень може не відрізнятись)<br><br>Техніка: ноутбук/комп'ютер або планшет (від 8 р.)<br>Методика: комунікативна + натуральний підхід<br>- Студент говорить 70% уроку<br>- Нетривіальні теми: майнд-мапи, серіали, конфлікти у школі<br>- Без підручників і нудних завдань","title":"Формати навчання"},{"text":"Для дітей від 4 р., дорослих будь-якого рівня:<br>- Англійська (CEFR A0-C1) Standard/Premium<br>- Дитяча англійська (Kids Edition, 4+ р.)<br>- Дитяча математика<br>- Англійська з носієм мови (B1-C1)<br>- Relocation English (72 уроки)<br>- Підготовка до НМТ (64 уроки)<br>- IELTS підготовка<br>- IT-англійська, корпоративна<br>- PrimeTime (абонемент)","title":"Продукти / Курси"},{"text":"Для кого: ті, хто переїхав або планує<br>72 інтерактивні уроки, 50 хв, індивідуальні<br><br>8 компонентів курсу:<br>1. 72 уроки по релокації з викладачем<br>2. Онлайн платформа + тренажери<br>3. Відеолекції від експертів (соц. пакет, оренда, подарки)<br>4. Куратор + ком'юніті<br>5. Розмовні клуби 5 разів/тиждень<br>6. Готові гайди для щоденних ситуацій<br>7. Плейлисти для інтеграції англ у побут<br>8. Онлайн-гра «Супергерой англійської»<br><br>Тарифи:<br>Майже самостійно: 24 ур → 19 000 грн<br>Новий рівень: 48 ур → 29 200 грн<br>Курс з гарантією: 72 ур → 39 500 грн<br><br>Важливо: носій не знає укр/рос — студент має 100% володіти рівнем","title":"Relocation English"},{"text":"64 інтерактивні уроки, 50 хв, 2 рази/тиждень<br><br>Структура тесту:<br>- Вибір однієї відповіді: 5<br>- Встановлення відповідностей: 11<br>- Заповнення пропусків: 16<br>- Всього: 32 завдання / 180 хвилин<br><br>Мінімум 4 бали → 100-200 шкала<br>Немає: письмо, аудіювання<br><br>Для кого: учні 10-11 кл., мінімальний рівень B1+<br>НМТ введено в 2025 як спрощений ЗНО (через воєнні дії)","title":"НМТ підготовка з англійської"},{"text":"Ти (Т), Клієнт (К)<br><br>Т: «Добрий день! Мене звати [Ім'я], менеджер АнтиШколи. Зручно говорити пару хвилин?»<br>К: «Не актуально»<br>Т: «Розумію. Підкажіть — вже займаєтесь десь або просто немає часу?»<br>К: «Займаюсь, але мало розмовної практики»<br>Т: «Дуже круто! В якому форматі? Група чи індивідуально?»<br>К: «В групі»<br>Т: «Зрозумів. А якого рівня досягли і куди хочете рухатись?»<br>К: «B1, хочу вільно говорити»<br>Т: «Саме це вирішує наша школа. Студент говорить 50-70% уроку — тільки реальні ситуації, без граматики. У групі час ділиться між всіма, у нас весь урок — тільки для вас. Ми №1 в рейтингу 2025, 9.5 вже 9 років»<br>Т: «Пропоную спробувати безкоштовний пробний — жодних зобов'язань. Сьогодні чи завтра?»<br>К: «Завтра»<br>Т: «У першій чи другій половині дня?»<br>К: «О 15:00»<br>Т: «Чудово! Підкажіть ім'я і контакт — перед уроком прийде посилання. До зустрічі!»","title":"Повний діалог — Приклад"}];
            const generateCardId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
            const injected = rawCards.map((c, i) => ({
              id: generateCardId(),
              type: 'text',
              size: 'large',
              accent: 'none',
              title: c.title,
              content: c.text,
              createdAt: Date.now() - (rawCards.length - i) * 1000
            }));
            
            // Remove old empty cards
            const existingCards = (saved[asIdx].cards || []).filter(c => c.content && c.content.trim().length > 0 && !c.text);
            
            saved[asIdx].cards = [...injected, ...existingCards];
            saved[asIdx].injected_20_cards = 2;
            safeJsonStorageSet(SPACES_KEY, saved);
          } catch(e) { console.error('Failed to inject cards', e); }
        }
        return normalizeWorkspaces(saved);
      }
      throw new Error('Workspace payload is not a non-empty array');
    } catch (error) {
      const recoveryKey = `${SPACES_KEY}.recovery.${Date.now()}`;
      const recovered = safeStorageSet(recoveryKey, raw);
      spacesStorageWritesBlocked = !recovered;
      console.error(`Invalid workspace storage; recovery key: ${recoveryKey}`, error);
      showStorageNotice(recovered
        ? `Данные пространств были повреждены. Исходная запись сохранена как ${recoveryKey}; открыта безопасная стартовая копия.`
        : 'Данные пространств повреждены. Recovery-копию создать не удалось, поэтому исходная запись оставлена без изменений.');
    }
  }
  const migrated = loadCards();
  const initial = [
    { id: 'work', title: 'Новая работа', glyph: 'НР', cards: migrated },
    { id: 'personal', title: 'Личное', glyph: 'Л', cards: [] }
  ];
  if (!spacesStorageWritesBlocked) safeJsonStorageSet(SPACES_KEY, initial);
  return normalizeWorkspaces(initial);
}

function normalizeWorkspaces(spaces) {
  return spaces.map(space => {
    const requestedLayout = ['dashboard','gallery','list'].includes(space.view?.layout) ? space.view.layout : 'dashboard';
    const requestedSort = requestedLayout === 'dashboard' ? 'manual' : ['manual','newest','title','number'].includes(space.view?.sort) ? space.view.sort : 'manual';
    return {
      ...space,
      view: { layout:requestedLayout, sort:requestedSort },
      cards: Array.isArray(space.cards) ? space.cards.map((card, index) => ({
      ...card,
      createdAt: Number(card.createdAt) || Date.now() - index,
      ...(card.structured ? { structured:sanitizeRecap(card.structured) } : {}),
      ...(card.type === 'image' ? { linkUrl:card.linkUrl || '', imageFit:card.imageFit || 'contain' } : {})
      })) : []
    };
  });
}

function activeSpace() {
  return workspaces.find(space => space.id === activeSpaceId) || workspaces[0];
}

function persistWorkspaces() {
  const spacesSaved = safeJsonStorageSet(SPACES_KEY, workspaces);
  const activeSpaceSaved = safeStorageSet(ACTIVE_SPACE_KEY, activeSpaceId);
  return spacesSaved && activeSpaceSaved;
}

function activeMeeting(space = activeSpace()) {
  if (!space?.activeMeetingId) return null;
  const card = space.cards.find(item => item.id === space.activeMeetingId && item.type === 'transcript' && item.meetingState !== 'finalized');
  if (!card) { delete space.activeMeetingId; persistWorkspaces(); }
  return card || null;
}

function workspaceKnowledge(space = activeSpace()) {
  space.knowledge ||= { items:[], summary:'', facts:[], tags:[], playbook:[], revision:0 };
  space.knowledge.items ||= [];
  space.knowledge.chat ||= [];
  return space.knowledge;
}

function htmlToWorkspaceText(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '').replace(/<br\s*\/?>/gi, '\n');
  return String(template.content.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function workspaceCardText(card) {
  const parts = [];
  if (card.content) parts.push(htmlToWorkspaceText(card.content));
  if (card.items?.length) parts.push(card.items.map(item => `${item.checked ? '✓' : '•'} ${item.text || ''}`).join('\n'));
  if (card.links?.length) parts.push(card.links.map(item => `${item.label || 'Ссылка'}: ${item.url || ''}`).join('\n'));
  if (card.transcript) parts.push(`Расшифровка:\n${card.transcript}`);
  if (card.structured) parts.push(`Конспект:\n${JSON.stringify(sanitizeRecap(card.structured))}`);
  if (card.suggestedAnswer) parts.push(`Подсказка:\n${card.suggestedAnswer}`);
  if (card.knowledgeText) parts.push(card.knowledgeText);
  if (card.linkUrl) parts.push(`Ссылка: ${card.linkUrl}`);
  return parts.filter(Boolean).join('\n\n').trim();
}

const WORKSPACE_SEARCH_STOP_WORDS = new Set([
  'а','або','без','был','была','были','быть','в','ваш','ваша','ваше','ви','він','вона','вони','все','всю','где','для','до','его','ее','её','и','из','их','как','когда','коли','который','ли','ми','мне','мой','мы','на','нам','наш','не','него','нее','ні','но','о','об','он','она','они','от','по','про','с','свой','свого','так','там','то','у','уже','що','это','я'
]);

const WORKSPACE_SEARCH_CONCEPTS = [
  ['learning','навча','навчан','займа','обуча','учус','учит','занима'],
  ['tutor','репетитор','викладач','преподават','учител'],
  ['objection','запереч','возраж','відмов','отказ','каже','говорит','сказал','сказала'],
  ['price','ціна','цен','дорог','вартіст','стоим'],
  ['time','час','время','коли','когда','график','розклад','расписан'],
  ['trial','пробн','тестов','демо','подар'],
  ['result','результат','мета','цель','прогрес'],
  ['next','далі','дальше','ответит','відповіст','сказат','сказать']
];

function normalizeWorkspaceSearchText(value = '') {
  return String(value || '').toLocaleLowerCase('uk-UA')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е').replace(/ґ/g, 'г').replace(/[’'`]/g, '')
    .replace(/[^a-zа-яіїє0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function workspaceSearchTokens(value = '') {
  const tokens = normalizeWorkspaceSearchText(value).split(' ').filter(token => token.length >= 3 && !WORKSPACE_SEARCH_STOP_WORDS.has(token));
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const concept = WORKSPACE_SEARCH_CONCEPTS.find(([, ...roots]) => roots.some(root => token.startsWith(root)));
    if (concept) expanded.add(concept[0]);
  }
  return [...expanded];
}

function workspaceContextEntries(space = activeSpace()) {
  const knowledge = workspaceKnowledge(space);
  return [
    ...knowledge.items.filter(item => item.status !== 'processing').map((item, index) => ({
      id:item.id || `hub-${index}`, kind:'hub', label:`Материал хаба · ${item.title || 'Без названия'}`,
      title:item.title || 'Без названия', text:[item.text, item.summary, ...(item.facts || [])].filter(Boolean).join('\n')
    })),
    ...(knowledge.playbook || []).map((item, index) => ({
      id:`playbook-${index}`, kind:'playbook', label:`Готовый ответ · ${item.cue || 'Ситуация'}`,
      title:item.cue || 'Готовый ответ', text:`Ситуация: ${item.cue || ''}\nОтвет: ${item.response || ''}`
    })),
    ...(space.cards || []).map((card, index) => ({
      id:card.id || `card-${index}`, kind:'card', label:`Карточка · ${[card.kicker, card.title].filter(Boolean).join(' · ') || 'Без названия'}`,
      title:[card.kicker, card.title].filter(Boolean).join(' · ') || 'Без названия', text:workspaceCardText(card)
    }))
  ].filter(entry => String(entry.text || '').trim());
}

function rankWorkspaceEntries(space = activeSpace(), query = '') {
  const queryText = normalizeWorkspaceSearchText(query);
  const queryTokens = workspaceSearchTokens(query);
  const wantsSpokenReply = /(?:каже|говорит|сказал|сказала|запереч|возраж|що далі|что дальше|як відповісти|как ответить)/i.test(queryText);
  return workspaceContextEntries(space).map((entry, index) => {
    const titleText = normalizeWorkspaceSearchText(entry.title);
    const bodyText = normalizeWorkspaceSearchText(entry.text);
    const titleTokens = new Set(workspaceSearchTokens(entry.title));
    const bodyTokens = new Set(workspaceSearchTokens(entry.text));
    let score = 0;
    for (const token of queryTokens) {
      if (titleTokens.has(token)) score += 12;
      else if (titleText.includes(token)) score += 7;
      if (bodyTokens.has(token)) score += 4;
      else if (bodyText.includes(token)) score += 2;
    }
    if (queryText.length >= 8 && titleText.includes(queryText)) score += 40;
    if (wantsSpokenReply && /приєднання|уточнення|аргумент|заклик|сценар|готов(?:ый|а) ответ|відповідь/i.test(entry.text)) score += 16;
    if (wantsSpokenReply && entry.kind === 'card') score += 10;
    if (queryTokens.includes('tutor') && (titleTokens.has('learning') || bodyTokens.has('learning'))) score += 8;
    if (queryTokens.includes('learning') && titleTokens.has('learning')) score += 12;
    return { ...entry, score, index };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
}

function workspaceRelevantExcerpt(entry, query, limit) {
  const text = String(entry?.text || '').trim();
  if (text.length <= limit) return text;
  const normalized = normalizeWorkspaceSearchText(text);
  const positions = workspaceSearchTokens(query).map(token => normalized.indexOf(token)).filter(position => position >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, Math.min(text.length - limit, center - Math.floor(limit * 0.25)));
  return `${start ? '…' : ''}${text.slice(start, start + limit)}${start + limit < text.length ? '…' : ''}`;
}

function isBroadWorkspaceRequest(message = '') {
  return /(?:вс[еяю]\s+(?:информац|материал)|ус[ієї]\s+інформац|всі\s+матеріал|everything|entire\s+space|из\s+всего|з\s+усього)/i.test(message);
}

function isWorkspaceCardCommand(message = '') {
  return /(?:создай|сделай|собери|разложи|вынеси|сложи|створи|зроби|збери|розклади|винеси).{0,40}(?:карточ|картк)/i.test(message);
}

function buildSpaceChatContext(space = activeSpace(), query = '') {
  const knowledge = workspaceKnowledge(space);
  const ranked = rankWorkspaceEntries(space, query);
  const broad = isBroadWorkspaceRequest(query);
  const relevant = broad ? ranked : ranked.filter(entry => entry.score > 0);
  const selected = (relevant.length ? relevant : ranked).slice(0, broad ? 40 : 12);
  const budget = broad ? 120000 : 65000;
  const perEntryLimit = broad ? 4200 : 8500;
  const overview = [
    `Пространство: ${space.title}`,
    knowledge.summary ? `Общая выжимка: ${String(knowledge.summary).slice(0,5000)}` : '',
    knowledge.facts?.length ? `Подтверждённые факты:\n${knowledge.facts.slice(0,40).map(item => `• ${item}`).join('\n').slice(0,7000)}` : '',
    knowledge.tags?.length ? `Темы: ${knowledge.tags.slice(0,80).join(', ')}` : '',
    `Отобрано материалов по смыслу: ${selected.length} из ${ranked.length}`
  ].filter(Boolean).join('\n\n');
  let packet = `${overview}\n\nРЕЛЕВАНТНЫЕ МАТЕРИАЛЫ (сначала наиболее подходящие):`;
  selected.forEach((entry, index) => {
    const excerpt = workspaceRelevantExcerpt(entry, query, perEntryLimit);
    const block = `\n\n[${index + 1}] ${entry.label}\n${excerpt}`;
    if (packet.length + block.length <= budget) packet += block;
  });
  return packet.slice(0,budget);
}

function localSpaceChatAnswer(space, message) {
  if (isWorkspaceCardCommand(message)) return null;
  const best = rankWorkspaceEntries(space, message)[0];
  if (!best || best.score < 12) return null;
  const excerpt = workspaceRelevantExcerpt(best, message, 3200);
  if (!excerpt) return null;
  const ukrainian = /[іїєґ]|\b(?:що|коли|далі|людина|вони)\b/i.test(message);
  return {
    text:`${ukrainian ? 'У матеріалах є готова відповідь' : 'В материалах есть готовый ответ'} «${best.title}»:\n\n${excerpt}`,
    provider:ukrainian ? 'матеріали простору' : 'материалы пространства'
  };
}

function isWeakSpaceChatAnswer(answer = '') {
  return /(?:не нашлось достаточного ответа|недостаточно (?:ответа|сведений|информации)|не знайшлося достатньої відповіді|недостатньо (?:відомостей|інформації))/i.test(answer);
}

function importMeetingToKnowledge(space, card) {
  if (!card.structured) return;
  const s = card.structured;
  let text = '';
  if (s.summary) {
    text += `Короткий підсумок:\n${s.summary}\n\n`;
  }
  if (s.keyPoints && s.keyPoints.length) {
    text += `Ключові моменти:\n${s.keyPoints.map(p => `• ${p}`).join('\n')}\n\n`;
  }
  if (s.decisions && s.decisions.length) {
    text += `Рішення:\n${s.decisions.map(d => `• ${d}`).join('\n')}\n\n`;
  }
  if (s.playbook && s.playbook.length) {
    text += `Шпаргалка (Q&A):\n${s.playbook.map(p => `Q: ${p.cue}\nA: ${p.response}`).join('\n\n')}\n\n`;
  }
  if (s.tasks && s.tasks.length) {
    text += `Завдання:\n${s.tasks.map(t => `• [ ] ${t.title}${t.owner ? ` (відповідальний: ${t.owner})` : ''}${t.due ? ` (термін: ${t.due})` : ''}`).join('\n')}\n\n`;
  }
  text = text.trim();
  if (!text) return;
  space.knowledge ||= { items:[], summary:'', facts:[], tags:[], playbook:[], revision:0 };
  space.knowledge.items = space.knowledge.items || [];
  const existingIndex = space.knowledge.items.findIndex(item => item.sourceCardId === card.id);
  const title = card.title || `Зустріч: ${new Date(card.createdAt).toLocaleDateString('uk-UA')}`;
  if (existingIndex >= 0) {
    if (space.knowledge.items[existingIndex].text === text && space.knowledge.items[existingIndex].title === title) {
      return;
    }
    space.knowledge.items[existingIndex].text = text;
    space.knowledge.items[existingIndex].title = title;
  } else {
    space.knowledge.items.push({
      id: crypto.randomUUID(),
      type: 'text',
      title,
      text,
      createdAt: Date.now(),
      sourceCardId: card.id,
      imported: true
    });
  }
  card.importedToKnowledge = true;
  space.knowledge.revision = Number(space.knowledge.revision || 0) + 1;
  persistWorkspaces();
  if (space.id === activeSpaceId && knowledgeDialog.open) {
    renderKnowledgeHub();
  }
  void consolidateWorkspaceKnowledge(space.id);
}

function setKnowledgeHubTab(tab) {
  knowledgeHubTab = tab === 'materials' ? 'materials' : 'chat';
  document.querySelectorAll('[data-knowledge-tab]').forEach(button => button.classList.toggle('active', button.dataset.knowledgeTab === knowledgeHubTab));
  document.getElementById('space-chat-panel').hidden = knowledgeHubTab !== 'chat';
  document.getElementById('knowledge-materials-panel').hidden = knowledgeHubTab !== 'materials';
}

function renderSpaceChat() {
  const knowledge = workspaceKnowledge();
  const messages = knowledge.chat.slice(-80);
  const welcome = `<article class="space-chat-message assistant welcome"><span>✦</span><div><strong>Чат пространства</strong><p>Я использую материалы хаба и все карточки этой доски. Спросите что угодно или скажите, какие карточки собрать.</p></div></article>`;
  const history = messages.map(message => {
    const created = Number(message.createdCards || 0);
    const meta = [created ? `Создано карточек: ${created}` : '', message.provider ? message.provider : ''].filter(Boolean).join(' · ');
    return `<article class="space-chat-message ${message.role === 'user' ? 'user' : 'assistant'}"><span>${message.role === 'user' ? 'Вы' : '✦'}</span><div><strong>${message.role === 'user' ? 'Вы' : 'Пространство AI'}</strong><p>${escapeHtml(message.text || '').replace(/\n/g, '<br>')}</p>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</div></article>`;
  }).join('');
  const pending = spaceChatBusy && spaceChatBusySpaceId === activeSpaceId ? '<article class="space-chat-message assistant pending"><span>✦</span><div><strong>Изучаю пространство…</strong><p>Сопоставляю материалы и готовлю ответ.</p></div></article>' : '';
  spaceChatFeed.innerHTML = `${welcome}${history}${pending}`;
  const sendButton = document.getElementById('space-chat-send');
  sendButton.disabled = spaceChatBusy;
  spaceChatInput.disabled = spaceChatBusy;
  requestAnimationFrame(() => { spaceChatFeed.scrollTop = spaceChatFeed.scrollHeight; });
}

function renderKnowledgeHub() {
  const knowledge = workspaceKnowledge();
  document.getElementById('knowledge-title').textContent = `Пространство AI · ${activeSpace().title}`;
  document.getElementById('knowledge-summary').textContent = knowledge.processing ? 'AI обновляет общую базу знаний…' : knowledge.summary || 'Добавьте инструкции, факты, термины или изображения — помощник будет учитывать их только в этом пространстве.';
  knowledgeFeed.innerHTML = knowledge.items.length ? knowledge.items.slice().reverse().map(item => `<article class="knowledge-item" data-knowledge-id="${escapeAttr(item.id)}">${item.imageSrc ? `<img src="${escapeAttr(item.imageSrc)}" alt="">` : '<span class="knowledge-item-icon">Aa</span>'}<div><strong>${escapeHtml(item.title || (item.type === 'image' ? 'Изображение' : 'Заметка'))}</strong><p>${escapeHtml(String(item.summary || item.text || (item.status === 'processing' ? 'Обрабатываю изображение…' : 'Нет извлечённого текста')).slice(0,700))}</p></div><button type="button" data-remove-knowledge="${escapeAttr(item.id)}" aria-label="Удалить">×</button></article>`).join('') : '<p class="meeting-empty">Здесь пока пусто. Вставьте текст или изображение — отдельная карточка на доске не создастся.</p>';
  knowledgeFeed.querySelectorAll('[data-remove-knowledge]').forEach(button => button.addEventListener('click', () => {
    knowledge.items = knowledge.items.filter(item => item.id !== button.dataset.removeKnowledge);
    knowledge.revision++;
    persistWorkspaces();
    renderKnowledgeHub();
    void consolidateWorkspaceKnowledge(activeSpace().id);
  }));
  document.getElementById('knowledge-count').textContent = knowledge.items.length;
  document.getElementById('knowledge-tab-count').textContent = knowledge.items.length;
  renderSpaceChat();
  setKnowledgeHubTab(knowledgeHubTab);
}

async function consolidateWorkspaceKnowledge(spaceId) {
  const space = workspaces.find(item => item.id === spaceId);
  if (!space?.knowledge?.items?.length || !window.sloy?.consolidateKnowledge) return;
  const knowledge = space.knowledge;
  const revision = Number(knowledge.revision || 0);
  const runId = crypto.randomUUID();
  knowledge.processing = true;
  knowledge.processingRunId = runId;
  if (spaceId === activeSpaceId && knowledgeDialog.open) renderKnowledgeHub();
  const items = knowledge.items.filter(item => item.status !== 'processing').map(item => ({ title:item.title, text:item.text || item.summary || '' }));
  try {
    const result = await window.sloy.consolidateKnowledge({ items, language:loadAiSettings().transcriptionLanguage || 'uk' });
    if (revision !== Number(knowledge.revision || 0)) return;
    if (result?.ok) {
      knowledge.summary = result.result.summary || '';
      knowledge.facts = dedupeStrings(result.result.facts || []);
      knowledge.tags = dedupeStrings(result.result.tags || []);
      knowledge.playbook = dedupeObjects(result.result.playbook || [], item => `${item.cue} ${item.response}`);
    }
  } catch {
    if (spaceId === activeSpaceId) showToast('Не удалось обновить базу знаний · материалы сохранены');
  } finally {
    if (knowledge.processingRunId === runId) {
      knowledge.processing = false;
      delete knowledge.processingRunId;
    }
    persistWorkspaces();
    if (spaceId === activeSpaceId && knowledgeDialog.open) renderKnowledgeHub();
  }
}

function addKnowledgeText() {
  const text = knowledgeInput.value.trim();
  if (!text) return;
  const knowledge = workspaceKnowledge();
  const firstLine = text.split(/\r?\n/)[0];
  knowledge.items.push({ id:crypto.randomUUID(), type:'text', title:firstLine.slice(0,80) || 'Заметка', text, createdAt:Date.now() });
  knowledge.revision++;
  knowledgeInput.value = '';
  persistWorkspaces();
  renderKnowledgeHub();
  void consolidateWorkspaceKnowledge(activeSpaceId);
}

function publishSpaceChatCards(space, drafts, sourceMessageId) {
  const accents = ['#6d63e8','#2dbfae','#ef6f72','#d59b2f','#4b95e8','#9b6bd9','#e17c4d','#6477d8'];
  const generated = (Array.isArray(drafts) ? drafts : []).slice(0,16).map((item, index) => ({
    id:crypto.randomUUID(), createdAt:Date.now() + index, type:'text',
    size:(item.points || []).length > 6 ? 'medium' : 'small', accent:accents[index % accents.length],
    kicker:item.kicker || 'AI · ПРОСТРАНСТВО', title:item.title,
    content:`<ul class="board-cheat-list">${(item.points || []).map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`,
    spaceChatSource:sourceMessageId, autoGenerated:true
  })).filter(card => card.title && card.content);
  if (generated.length) space.cards.unshift(...generated);
  return generated;
}

function spaceChatErrorMessage(reason) {
  if (reason === 'missing_key') return 'Для чата подключите Cerebras, xAI, Gemini или Groq через кнопку ✦ внизу боковой панели.';
  if (reason === 'http_429') return 'Лимит AI-провайдеров временно исчерпан. Материалы пространства сохранены — попробуйте немного позже.';
  if (reason === 'input_limit' || reason === 'http_413') return 'Пространство оказалось слишком большим для одного запроса. Уточните тему или попросите обработать отдельную часть.';
  if (reason === 'aborted') return 'Запрос был остановлен.';
  return `Не удалось получить ответ от AI (${reason || 'ошибка сети'}). Материалы пространства не изменены.`;
}

async function sendSpaceChatMessage(preset = '') {
  if (spaceChatBusy || !window.sloy?.spaceChat) return;
  const message = String(preset || spaceChatInput.value || '').trim();
  if (!message) return;
  const space = activeSpace();
  const knowledge = workspaceKnowledge(space);
  const history = knowledge.chat.slice(-8).map(item => ({ role:item.role, text:item.text }));
  const retrievalQuery = [...history.filter(item => item.role === 'user').slice(-2).map(item => item.text), message].join('\n');
  const localAnswer = localSpaceChatAnswer(space, retrievalQuery);
  const userMessage = { id:crypto.randomUUID(), role:'user', text:message, createdAt:Date.now() };
  knowledge.chat.push(userMessage);
  knowledge.chat = knowledge.chat.slice(-80);
  spaceChatInput.value = '';
  spaceChatBusy = true;
  spaceChatBusySpaceId = space.id;
  persistWorkspaces();
  renderKnowledgeHub();
  try {
    const result = await window.sloy.spaceChat({
      message, history, context:buildSpaceChatContext(space, retrievalQuery),
      language:loadAiSettings().transcriptionLanguage || 'uk'
    });
    let created = [];
    if (result?.ok && result.action === 'create_cards') created = publishSpaceChatCards(space, result.cards, userMessage.id);
    const useLocalAnswer = localAnswer && (!result?.ok || (result.action !== 'create_cards' && isWeakSpaceChatAnswer(result.answer)));
    knowledge.chat.push({
      id:crypto.randomUUID(), role:'assistant',
      text:useLocalAnswer ? localAnswer.text : (result?.ok ? result.answer : spaceChatErrorMessage(result?.reason)),
      provider:useLocalAnswer ? localAnswer.provider : (result?.ok ? result.provider || '' : ''), createdCards:created.length, createdAt:Date.now()
    });
    knowledge.chat = knowledge.chat.slice(-80);
    persistWorkspaces();
    if (space.id === activeSpaceId && created.length) {
      cards = space.cards;
      render();
      showToast(`${created.length} карточек создано из материалов пространства`);
    }
  } catch {
    const localAnswer = localSpaceChatAnswer(space, retrievalQuery);
    knowledge.chat.push({ id:crypto.randomUUID(), role:'assistant', text:localAnswer?.text || spaceChatErrorMessage('network'), provider:localAnswer?.provider || '', createdAt:Date.now() });
    knowledge.chat = knowledge.chat.slice(-80);
    persistWorkspaces();
  } finally {
    spaceChatBusy = false;
    spaceChatBusySpaceId = '';
    if (space.id === activeSpaceId && knowledgeDialog.open) {
      renderKnowledgeHub();
      setTimeout(() => spaceChatInput.focus(), 30);
    }
  }
}

async function addKnowledgeImage(file) {
  if (!file?.type?.startsWith('image/')) return;
  if (file.size > 20_000_000) { showToast('Изображение должно быть меньше 20 МБ'); return; }
  const spaceId = activeSpaceId;
  const knowledge = workspaceKnowledge();
  const item = { id:crypto.randomUUID(), type:'image', title:file.name?.replace(/\.[^.]+$/, '') || 'Изображение', text:'', summary:'', imageSrc:'', status:'processing', createdAt:Date.now() };
  knowledge.items.push(item); knowledge.revision++;
  persistWorkspaces(); renderKnowledgeHub();
  let analyzed = false;
  try {
    let analysisFile = file;
    if (file.size > 2_700_000) {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .86));
        if (compressed) analysisFile = compressed;
        bitmap.close();
      } catch {}
    }
    const bytes = await analysisFile.arrayBuffer();
    const mimeType = analysisFile.type || file.type;
    const saved = await window.sloy?.saveAsset({ bytes, extension:(mimeType.split('/')[1] || 'png').replace('jpeg','jpg') });
    item.imageSrc = saved?.url || '';
    persistWorkspaces();
    if (spaceId === activeSpaceId && knowledgeDialog.open) renderKnowledgeHub();
    const result = await window.sloy?.analyzeKnowledgeImage({ bytes, mimeType, language:loadAiSettings().transcriptionLanguage || 'uk' });
    const space = workspaces.find(value => value.id === spaceId);
    const current = space?.knowledge?.items?.find(value => value.id === item.id);
    if (!current) return;
    current.status = result?.ok ? 'ready' : 'error';
    if (result?.ok) {
      current.title = result.result.title || current.title;
      current.text = result.result.extractedText || '';
      current.summary = result.result.summary || current.text;
      current.facts = result.result.facts || [];
      current.tags = result.result.tags || [];
      analyzed = true;
    } else current.summary = result?.reason === 'missing_groq_key' ? 'Для обработки изображения подключите Groq в настройках ✦.' : `Не удалось обработать изображение: ${result?.reason || 'ошибка'}`;
  } catch {
    const space = workspaces.find(value => value.id === spaceId);
    const current = space?.knowledge?.items?.find(value => value.id === item.id);
    if (current) {
      current.status = 'error';
      current.summary = 'Не удалось сохранить или обработать изображение. Попробуйте ещё раз.';
    }
    showToast('Не удалось добавить изображение в базу знаний');
  } finally {
    const space = workspaces.find(value => value.id === spaceId);
    const current = space?.knowledge?.items?.find(value => value.id === item.id);
    if (space && current) {
      if (current.status === 'processing') current.status = 'error';
      space.knowledge.revision++;
      persistWorkspaces();
      if (spaceId === activeSpaceId && knowledgeDialog.open) renderKnowledgeHub();
    }
  }
  if (analyzed) void consolidateWorkspaceKnowledge(spaceId);
}

function aggregateMeetingTranscript(card, currentSegment = null) {
  const segments = [...(card.segments || [])];
  if (currentSegment && !segments.some(item => item.id === currentSegment.id)) segments.push(currentSegment);
  return segments.map(segment => String(segment.transcript || '').trim()).filter(Boolean).join('\n');
}

function saveCards(message = 'Изменения сохранены') {
  activeSpace().cards = cards;
  const saved = persistWorkspaces();
  if (saved && message) showToast(message);
  return saved;
}

function renderSpaces() {
  const list = document.querySelector('.space-list');
  const recordingSpId = recordingSession?.spaceId;
  list.innerHTML = workspaces.map(space => `<button class="space ${space.id === activeSpaceId ? 'active' : ''} ${space.id === recordingSpId ? 'space-recording' : ''}" data-space="${escapeAttr(space.id)}" aria-label="${escapeAttr(space.title)}"><span>${escapeHtml(space.glyph)}</span><em>${escapeHtml(space.title)}</em>${space.id === recordingSpId ? '<i class="rec-dot"></i>' : ''}</button>`).join('') + `<button class="space add-space" aria-label="Додати простір"><span>+</span><em>Додати</em></button>`;
  const current = activeSpace();
  document.querySelector('#workspace-title').textContent = current.title;
  document.querySelector('.workspace-glyph').textContent = current.glyph;
  document.getElementById('knowledge-count').textContent = current.knowledge?.items?.length || 0;
  list.querySelectorAll('[data-space]').forEach(button => button.addEventListener('click', () => switchSpace(button.dataset.space)));
  list.querySelector('.add-space').addEventListener('click', openSpaceDialog);
}

function draggedCardsFor(id) {
  const ids = selectedIds.has(id) && selectedIds.size > 1 ? selectedIds : new Set([id]);
  return cards.filter(card => ids.has(card.id));
}

function blockedCrossSpaceCard(card) {
  const processing = String(card?.processing || '');
  return !card
    || recordingSession?.card?.id === card.id
    || card.detachedMeeting
    || card.type === 'transcript' && card.meetingState !== 'finalized'
    || /^(?:saving|transcribing|structuring|live:)/.test(processing)
    || aiProgressCards.has(card.id);
}

function clearSpaceDropTarget() {
  document.querySelector('.space-list')?.classList.remove('card-transfer-active');
  document.querySelectorAll('.space.card-drop-target,.space.card-drop-blocked').forEach(button => {
    button.classList.remove('card-drop-target', 'card-drop-blocked');
    button.removeAttribute('data-drop-count');
  });
}

function crossSpaceDropTargetAtPoint(clientX, clientY, movingCards) {
  const button = document.elementFromPoint(clientX, clientY)?.closest?.('.space[data-space]');
  clearSpaceDropTarget();
  if (!button || button.dataset.space === activeSpaceId) return null;
  document.querySelector('.space-list')?.classList.add('card-transfer-active');
  const blocked = movingCards.some(blockedCrossSpaceCard);
  button.classList.add(blocked ? 'card-drop-blocked' : 'card-drop-target');
  button.dataset.dropCount = String(movingCards.length);
  return { button, spaceId:button.dataset.space, blocked };
}

function invalidateKnowledgeAfterCardMove(space) {
  const knowledge = workspaceKnowledge(space);
  knowledge.revision = Number(knowledge.revision || 0) + 1;
  knowledge.summary = '';
  knowledge.facts = [];
  knowledge.tags = [];
  knowledge.playbook = [];
}

function moveCardsToWorkspace(targetSpaceId, movingCards) {
  const source = activeSpace();
  const target = workspaces.find(space => space.id === targetSpaceId);
  const moving = movingCards.filter(card => source.cards.includes(card));
  if (!target || target === source || !moving.length) return false;
  if (moving.some(blockedCrossSpaceCard)) {
    showToast('Активную или обрабатываемую встречу сначала нужно завершить');
    return false;
  }
  const movingIds = new Set(moving.map(card => card.id));
  const sourceIndexes = moving.map(card => ({ id:card.id, index:source.cards.indexOf(card) }));
  const sourceKnowledge = workspaceKnowledge(source);
  const targetKnowledge = workspaceKnowledge(target);
  const linkedKnowledge = sourceKnowledge.items.filter(item => movingIds.has(item.sourceCardId));
  const linkedKnowledgeIds = new Set(linkedKnowledge.map(item => item.id));
  source.cards = source.cards.filter(card => !movingIds.has(card.id));
  target.cards = [...moving, ...target.cards.filter(card => !movingIds.has(card.id))];
  sourceKnowledge.items = sourceKnowledge.items.filter(item => !linkedKnowledgeIds.has(item.id));
  targetKnowledge.items.push(...linkedKnowledge.filter(item => !targetKnowledge.items.some(existing => existing.id === item.id)));
  invalidateKnowledgeAfterCardMove(source);
  invalidateKnowledgeAfterCardMove(target);
  cards = source.cards;
  selectedIds.clear();
  pushCardUndo({ type:'move-space', label:moving.length > 1 ? 'Перенос группы' : 'Перенос карточки', sourceSpaceId:source.id, targetSpaceId:target.id, cardIds:moving.map(card => card.id), sourceIndexes, knowledgeIds:[...linkedKnowledgeIds] });
  persistWorkspaces();
  renderSpaces();
  render();
  showToast(moving.length > 1 ? `${moving.length} карточки перенесены в «${target.title}»` : `Карточка перенесена в «${target.title}»`, {
    duration:4200, actionLabel:'Открыть', onAction:() => switchSpace(target.id)
  });
  return true;
}

function restoreCrossSpaceMove(entry) {
  const source = workspaces.find(space => space.id === entry.sourceSpaceId);
  const target = workspaces.find(space => space.id === entry.targetSpaceId);
  if (!source || !target) return false;
  const ids = new Set(entry.cardIds || []);
  const moving = target.cards.filter(card => ids.has(card.id));
  if (!moving.length) return false;
  target.cards = target.cards.filter(card => !ids.has(card.id));
  const byId = new Map(moving.map(card => [card.id, card]));
  [...(entry.sourceIndexes || [])].sort((a, b) => a.index - b.index).forEach(({ id, index }) => {
    const card = byId.get(id);
    if (card) source.cards.splice(Math.max(0, Math.min(index, source.cards.length)), 0, card);
  });
  const knowledgeIds = new Set(entry.knowledgeIds || []);
  const sourceKnowledge = workspaceKnowledge(source);
  const targetKnowledge = workspaceKnowledge(target);
  const linked = targetKnowledge.items.filter(item => knowledgeIds.has(item.id));
  targetKnowledge.items = targetKnowledge.items.filter(item => !knowledgeIds.has(item.id));
  sourceKnowledge.items.push(...linked.filter(item => !sourceKnowledge.items.some(existing => existing.id === item.id)));
  invalidateKnowledgeAfterCardMove(source);
  invalidateKnowledgeAfterCardMove(target);
  if (activeSpaceId === source.id) cards = source.cards;
  else if (activeSpaceId === target.id) cards = target.cards;
  selectedIds.clear();
  persistWorkspaces();
  renderSpaces();
  render();
  showToast(`Отменено: ${entry.label}`);
  return true;
}

function switchSpace(id) {
  if (id === activeSpaceId) return;
  activeSpace().cards = cards;
  activeSpaceId = id;
  selectedIds.clear();
  cards = activeSpace().cards;
  search.value = '';
  saveCards('Пространство открыто');
  renderSpaces();
  render();
}

function displayCards(sourceCards = cards, view = activeSpace().view) {
  const displayed = [...sourceCards];
  if (view?.layout === 'dashboard' || view?.sort === 'manual') return displayed;
  if (view?.sort === 'newest') return displayed.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (view?.sort === 'title') return displayed.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru', { sensitivity:'base' }));
  if (view?.sort === 'number') return cardsInNumberOrder(displayed);
  return displayed;
}

function updateViewControls() {
  const view = activeSpace().view;
  document.querySelectorAll('[data-layout]').forEach(button => {
    const active = button.dataset.layout === view.layout;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const sort = document.querySelector('#sort-cards');
  sort.value = view.layout === 'dashboard' ? 'manual' : view.sort;
  sort.disabled = view.layout === 'dashboard';
  sort.closest('.sort-control')?.classList.toggle('disabled', sort.disabled);
}

function setLayout(layout) {
  if (!['dashboard', 'gallery', 'list'].includes(layout)) return;
  const view = activeSpace().view;
  view.layout = layout;
  if (layout === 'dashboard') view.sort = 'manual';
  selectedIds.clear();
  saveCards('Режим отображения сохранён');
  render();
}

function setCardSort(sort) {
  const view = activeSpace().view;
  if (view.layout === 'dashboard' || !['manual', 'newest', 'title', 'number'].includes(sort)) return;
  view.sort = sort;
  saveCards('Сортировка сохранена');
  render();
}

function sortActiveCardsByNumber() {
  const numberedCount = cards.filter(card => cardSequenceNumber(card) !== null).length;
  if (!numberedCount) {
    showToast('В этом пространстве нет карточек с номером в начале');
    return;
  }
  const undoState = captureCardLayoutState();
  cards.splice(0, cards.length, ...cardsInNumberOrder(cards));
  activeSpace().view.sort = 'manual';
  if (activeSpace().view.layout === 'dashboard') cards.forEach(card => { delete card.position; });
  else cards.forEach(card => {
    delete card.flowOffsetX;
    delete card.flowOffsetY;
    delete card.flowLayer;
  });
  pushCardLayoutUndo('Сортировка карточек', undoState);
  saveCards(`Карточки расставлены по номерам · ${numberedCount}`);
  render();
}

function findMeetingBoardPlacement(space) {
  const width = Math.max(0, board.clientWidth - 28);
  const height = Math.max(0, board.clientHeight - 28);
  if (width < 520 || height < 420) return null;
  const cardWidth = Math.min(900, Math.max(560, width * .62));
  const cardHeight = Math.min(700, Math.max(430, height * .68));
  const occupied = (space?.cards || []).filter(card => !card.detachedMeeting && card.position).map(card => card.position);
  const intersects = candidate => occupied.some(rect => candidate.x < rect.x + rect.w + 14 && candidate.x + candidate.w + 14 > rect.x && candidate.y < rect.y + rect.h + 14 && candidate.y + candidate.h + 14 > rect.y);
  for (let y = 14; y + cardHeight <= height; y += 24) {
    for (let x = 14; x + cardWidth <= width; x += 24) {
      const candidate = { x, y, w:cardWidth, h:cardHeight };
      if (!intersects(candidate)) return candidate;
    }
  }
  return null;
}

function detachedMeetingPayload(card) {
  const recap = sanitizeRecap(card.structured || {});
  const progress = aiProgressCards.get(card.id);
  return {
    cardId:card.id, title:card.title || 'Текущая встреча', state:card.meetingState || (card.live ? 'active' : 'paused'),
    duration:card.duration || '00:00', processing:card.processing || '', progress:progress ? { message:progress.message, current:progress.current, total:progress.total } : null,
    transcript:String(card.transcript || '').slice(-500000), summary:recap.summary || '', keyPoints:recap.keyPoints || [], topics:recap.topics || [],
    decisions:recap.decisions || [], tasks:recap.tasks || [], questions:recap.questions || [], playbook:recap.playbook || [],
    suggestion:card.suggestedAnswer || '', suggestedFor:card.suggestedFor || ''
  };
}

function syncDetachedMeetingWindow(card) {
  if (!card?.detachedMeeting) return;
  window.sloy?.showMeetingWindow?.(detachedMeetingPayload(card));
}

function render() {
  resetImageZoomPreview();
  renderSpaces();
  const view = activeSpace().view;
  const dashboard = view.layout === 'dashboard';
  updateViewControls();
  board.className = `board ${dashboard ? 'freeform-board' : `layout-${view.layout}`}`;
  cards.forEach(card => { if (card.structured) card.structured = sanitizeRecap(card.structured); });
  if (dashboard) ensureCardPositions();
  board.innerHTML = '';
  const visibleCards = dashboard ? cards.filter(card => !card.detachedMeeting) : cards;
  displayCards(visibleCards, view).forEach((card, index) => {
    const el = document.createElement('article');
    el.className = `card ${card.size || 'medium'} ${card.type === 'image' ? 'image-card' : ''} ${card.type === 'transcript' ? 'transcript-card' : ''} ${card.boardCheatSource ? 'board-cheat-card' : ''} ${card.antischoolVersion ? 'antischool-card' : ''}`;
    el.dataset.id = card.id;
    el.classList.toggle('selected', selectedIds.has(card.id));
    el.style.setProperty('--accent', card.accent || '#7065e8');
    el.style.animationDelay = `${Math.min(index * 28, 190)}ms`;
    if (dashboard) {
      el.style.left = `${card.position.x}px`;
      el.style.top = `${card.position.y}px`;
      el.style.width = `${card.position.w}px`;
      el.style.height = `${card.position.h}px`;
    } else if (view.layout === 'gallery') {
      el.style.setProperty('--flow-columns', String(Math.max(1, Math.min(3, Number(card.flowColumns) || 1))));
      el.style.setProperty('--flow-rows', String(Math.max(2, Math.min(10, Number(card.flowRows) || 4))));
      el.style.left = `${Number(card.flowOffsetX) || 0}px`;
      el.style.top = `${Number(card.flowOffsetY) || 0}px`;
      el.style.zIndex = String(Math.max(0, Number(card.flowLayer) || 0));
    } else {
      el.style.setProperty('--flow-list-height', `${Math.max(90, Math.min(720, Number(card.flowHeight) || 90))}px`);
      el.style.left = `${Number(card.flowOffsetX) || 0}px`;
      el.style.top = `${Number(card.flowOffsetY) || 0}px`;
      el.style.zIndex = String(Math.max(0, Number(card.flowLayer) || 0));
    }
    el.tabIndex = 0;
    el.innerHTML = cardMarkup(card);
    if (editMode) el.insertAdjacentHTML('beforeend', '<button class="resize-handle" aria-label="Изменить размер" title="Потяните, чтобы изменить размер"></button>');
    board.appendChild(el);
  });
  board.style.minHeight = '';
  bindCardEvents();
  updateSelectionBar();
  filterCards(search.value);
  // A saved detached meeting must not reopen merely because the application rendered.
  // The separate window is opened only by the recording session that currently owns it.
  const detachedMeetings = cards.filter(card => card.detachedMeeting && card.type === 'transcript');
  const detachedToSync = detachedMeetings.find(card => card.id === recordingSession?.card?.id);
  if (detachedToSync) syncDetachedMeetingWindow(detachedToSync);
}

function ensureCardPositions() {
  const availableWidth = Math.max(board.clientWidth - 28, 720);
  const columns = availableWidth > 1350 ? 4 : availableWidth > 920 ? 3 : 2;
  const gap = 14;
  const columnWidth = (availableWidth - gap * (columns - 1)) / columns;
  const occupied = cards.filter(card => !card.detachedMeeting && card.position && Number.isFinite(card.position.x)).map(card => card.position);
  const intersects = candidate => occupied.some(rect => candidate.x < rect.x + rect.w + gap && candidate.x + candidate.w + gap > rect.x && candidate.y < rect.y + rect.h + gap && candidate.y + candidate.h + gap > rect.y);
  cards.filter(card => !card.detachedMeeting && (!card.position || !Number.isFinite(card.position.x))).forEach(card => {
    const span = ['wide','large'].includes(card.size) && columns > 2 ? 2 : 1;
    const width = card.type === 'image' ? columnWidth : columnWidth * span + gap * (span - 1);
    const plainLength = String(card.content || card.transcript || '').replace(/<[^>]+>/g, '').length;
    const itemCount = card.items?.length || card.structured?.keyPoints?.length || 0;
    const baseHeight = Math.max(card.autoHeight || 0, card.type === 'image' ? 240 : card.type === 'transcript' ? 430 : Math.min(520, Math.max(card.size === 'small' ? 190 : 235, 150 + plainLength * .34 + itemCount * 24)));
    let placed = null;
    const maxBottom = occupied.reduce((max, rect) => Math.max(max, rect.y + rect.h), 0);
    for (let y = 14; y <= maxBottom + 900 && !placed; y += 22) {
      for (let column = 0; column <= columns - span; column++) {
        const candidate = { x:14 + column * (columnWidth + gap), y, w:width, h:baseHeight };
        if (!intersects(candidate)) { placed = candidate; break; }
      }
    }
    card.position = placed || { x:14, y:maxBottom + gap, w:width, h:baseHeight };
    occupied.push(card.position);
  });
  saveCards('');
}

function highlightSegmentOffset(highlight, segment) {
  const explicit = Number(highlight?.segmentOffsetSeconds ?? highlight?.offsetSeconds);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const legacyAt = Number(highlight?.at);
  const startedAt = Number(segment?.startedAt);
  if (Number.isFinite(legacyAt) && legacyAt > 1e11 && Number.isFinite(startedAt)) return Math.max(0, (legacyAt - startedAt) / 1000);
  if (Number.isFinite(legacyAt) && legacyAt >= 0 && legacyAt < 1e11) return legacyAt;
  return 0;
}

function meetingHighlightEntries(card) {
  const segments = card.segments || [];
  const entries = new Map();
  const add = (highlight, fallbackSegment = null) => {
    if (!highlight) return;
    const segmentId = highlight.segmentId || fallbackSegment?.id || '';
    const segment = segments.find(item => item.id === segmentId) || fallbackSegment;
    const segmentOffsetSeconds = highlightSegmentOffset(highlight, segment);
    const segmentIndex = segment ? segments.indexOf(segment) : -1;
    const precedingSeconds = segmentIndex > 0 ? segments.slice(0, segmentIndex).reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0) : 0;
    const explicitGlobal = Number(highlight.globalOffsetSeconds);
    const legacyAt = Number(highlight.at);
    const fallbackGlobal = !segment && Number.isFinite(legacyAt) && legacyAt > 1e11 && Number.isFinite(Number(card.createdAt))
      ? Math.max(0, (legacyAt - Number(card.createdAt)) / 1000)
      : precedingSeconds + segmentOffsetSeconds;
    const globalOffsetSeconds = Number.isFinite(explicitGlobal) && explicitGlobal >= 0 ? explicitGlobal : fallbackGlobal;
    const key = highlight.id || `${segmentId}:${Math.round(segmentOffsetSeconds * 10)}:${highlight.context || ''}`;
    entries.set(key, { ...highlight, segmentId, segmentOffsetSeconds, globalOffsetSeconds, segment });
  };
  (card.highlights || []).forEach(highlight => add(highlight));
  segments.forEach(segment => (segment.highlights || []).forEach(highlight => add(highlight, segment)));
  return [...entries.values()].sort((a, b) => a.globalOffsetSeconds - b.globalOffsetSeconds);
}

function meetingHighlightsMarkup(card) {
  const highlights = meetingHighlightEntries(card);
  if (!highlights.length) return '';
  return `<section class="meeting-highlights"><h3>★ Отмеченные моменты</h3><div>${highlights.map(highlight => {
    const context = String(highlight.context || '').trim() || 'Контекст не попал в расшифровку';
    const seekable = Boolean(highlight.segment?.audioSrc || highlight.segment?.sourceAudio?.mic || highlight.segment?.sourceAudio?.system);
    return `<button class="meeting-highlight" type="button" data-segment-id="${escapeAttr(highlight.segmentId)}" data-offset-seconds="${Math.max(0, highlight.segmentOffsetSeconds)}" ${seekable ? 'title="Перейти к моменту в аудио"' : 'disabled'}><time>${formatDuration(highlight.globalOffsetSeconds)}</time><span>${escapeHtml(context)}</span>${seekable ? '<em>▶</em>' : ''}</button>`;
  }).join('')}</div></section>`;
}

function seekMeetingHighlight(cardId, segmentId, offsetSeconds) {
  const card = cards.find(item => item.id === cardId);
  const segment = card?.segments?.find(item => item.id === segmentId);
  if (!card || !segment || !(segment.audioSrc || segment.sourceAudio?.mic || segment.sourceAudio?.system)) return;
  meetingTabs.set(cardId, 'audio');
  render();
  requestAnimationFrame(() => {
    const cardElement = document.querySelector(`[data-id="${CSS.escape(cardId)}"]`);
    const segmentElement = cardElement?.querySelector(`.meeting-segment[data-segment-id="${CSS.escape(segmentId)}"]`);
    const audio = segmentElement?.querySelector('audio');
    if (!audio) return;
    const seek = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : Number(segment.durationSeconds || 0);
      audio.currentTime = Math.max(0, Math.min(Number(offsetSeconds) || 0, duration || Number(offsetSeconds) || 0));
      audio.focus();
      audio.play().catch(() => {});
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener('loadedmetadata', seek, { once:true });
  });
}

function structuredNotesMarkup(card) {
  const recap = card?.structured;
  if (!recap) return '';
  const important = recap.keyPoints?.length ? `<section class="recap-section recap-important"><h3><span>★</span> Самое важное · ${recap.keyPoints.length}</h3><ol>${recap.keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ol></section>` : '';
  const topics = recap.topics?.length ? `<section class="recap-section recap-topics"><h3>Темы и детали</h3><ul>${recap.topics.map(topic => `<li><b>${escapeHtml(topic.title)}</b>${topic.summary ? `<span>${escapeHtml(topic.summary)}</span>` : ''}</li>`).join('')}</ul></section>` : '';
  const decisions = recap.decisions?.length ? `<section class="recap-section recap-decisions"><h3>Решения</h3><ul>${recap.decisions.slice(0,5).map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul></section>` : '';
  const tasks = recap.tasks?.length ? `<section class="recap-section recap-tasks"><h3>Что сделать</h3><ul>${recap.tasks.slice(0,6).map(task => `<li><span>${escapeHtml(task.title)}</span>${task.owner || task.due ? `<small>${[task.owner, task.due].filter(Boolean).map(escapeHtml).join(' · ')}</small>` : ''}</li>`).join('')}</ul></section>` : '';
  const questions = recap.questions?.length ? `<section class="recap-section recap-questions"><h3>Открытые вопросы</h3><ul>${recap.questions.slice(0,4).map(question => `<li>${escapeHtml(question)}</li>`).join('')}</ul></section>` : '';
  return `<div class="structured-notes"><div class="summary-copy-row"><span>Текст можно выделять и копировать</span><button class="copy-summary" type="button">Копировать конспект</button></div><section class="recap-hero"><span class="recap-label">КРАТКАЯ ВЫЖИМКА</span><strong>${escapeHtml(recap.summary || 'Итог встречи')}</strong></section>${important}${topics}<div class="recap-secondary">${decisions}${tasks}${questions}</div></div>`;
}

function structuredNotesText(card) {
  const recap = card?.structured;
  if (!recap) return '';
  const blocks = [];
  if (card.title) blocks.push(card.title);
  if (recap.summary) blocks.push(`КРАТКАЯ ВЫЖИМКА\n${recap.summary}`);
  if (recap.keyPoints?.length) blocks.push(`САМОЕ ВАЖНОЕ\n${recap.keyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n')}`);
  if (recap.topics?.length) blocks.push(`ТЕМЫ И ДЕТАЛИ\n${recap.topics.map(topic => `${topic.title}${topic.summary ? ` — ${topic.summary}` : ''}`).join('\n')}`);
  if (recap.decisions?.length) blocks.push(`РЕШЕНИЯ\n${recap.decisions.map(point => `• ${point}`).join('\n')}`);
  if (recap.tasks?.length) blocks.push(`ЧТО СДЕЛАТЬ\n${recap.tasks.map(task => `• ${task.title}${[task.owner, task.due].filter(Boolean).length ? ` (${[task.owner, task.due].filter(Boolean).join(' · ')})` : ''}`).join('\n')}`);
  if (recap.questions?.length) blocks.push(`ОТКРЫТЫЕ ВОПРОСЫ\n${recap.questions.map(question => `• ${question}`).join('\n')}`);
  return blocks.join('\n\n');
}

function boardAiComposerMarkup(card) {
  const instruction = escapeAttr(card.boardCheatInstruction || '');
  return `<form class="board-ai-composer"><header><div><strong>✦ AI для доски</strong><small>Опишите, какие карточки нужно одновременно видеть на экране</small></div></header><textarea class="board-ai-instruction" rows="3" maxlength="1600" placeholder="Например: вынеси отдельно возражения, точные ответы, цены и следующие шаги">${instruction}</textarea><div><button type="submit">Сформировать карточки на доске</button><span class="board-ai-status" role="status"></span></div></form>`;
}

function meetingProcessingMarkup(card) {
  if (!card.processing) return '';
  const progress = aiProgressCards.get(card.id);
  const isError = String(card.processing).startsWith('error:');
  const labels = {
    'live:connecting':'Подключаю живую расшифровку',
    'live:listening':'Живая расшифровка включена',
    saving:'Сохраняю локальную запись',
    transcribing:'AI расшифровывает аудио',
    structuring:'AI собирает полный конспект',
    'error:invalid_key':'Сохранён неверный API-ключ',
    'error:missing_key':'AI-провайдер не подключён',
    'error:http_401':'Провайдер отклонил API-ключ',
    'error:http_413':'Запрос оказался слишком большим',
    'error:http_429':'Исчерпан лимит запросов провайдера',
    'error:timeout':'Провайдер не ответил вовремя',
    'error:network':'Нет соединения с AI-провайдером',
    'error:network_or_parse':'AI вернул ответ, который не удалось обработать',
    'error:transcription':'Не удалось расшифровать аудио',
    'error:structure':'Не удалось собрать конспект',
    'error:ai':'AI-обработка завершилась с ошибкой',
    'error:save':'Не удалось полностью сохранить запись'
  };
  const label = progress?.message || labels[card.processing] || (isError ? `Обработка остановилась · ${String(card.processing).slice(6)}` : 'AI продолжает обработку');
  if (isError) return `<div class="transcript-processing error" role="status"><span class="processing-icon">!</span><div><strong>${escapeHtml(label)}</strong><small>Запись сохранена. Можно повторить обработку кнопкой ниже.</small></div></div>`;
  const total = Number(progress?.total || 0);
  const current = Math.min(total, Number(progress?.current || 0));
  const percent = total ? Math.round(current / total * 100) : 0;
  const details = total ? `${current} из ${total} частей · ${percent}%` : card.processing === 'transcribing' ? 'Загружаю и распознаю аудио — это может занять несколько минут' : 'Пожалуйста, не закрывайте приложение';
  return `<div class="transcript-processing active" role="status" aria-live="polite"><span class="processing-spinner"></span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(details)}</small><span class="processing-track ${total ? '' : 'indeterminate'}"><i style="width:${total ? percent : 32}%"></i></span></div>${total ? `<b>${percent}%</b>` : ''}</div>`;
}

function meetingAiActionStatusMarkup(card) {
  const busy = ['transcribing','structuring'].includes(card.processing);
  if (busy) return '<span class="meeting-ai-action-status working">Запрос принят · обработка идёт</span>';
  if (String(card.processing || '').startsWith('error:')) return '<span class="meeting-ai-action-status error">Последняя попытка не завершилась · можно повторить</span>';
  const completedAt = Number(card.aiSummaryUpdatedAt || card.aiTranscribedAt || 0);
  if (!completedAt && !card.structured && !card.transcript) return '';
  const time = completedAt ? new Date(completedAt).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
  const label = card.structured ? 'Расшифровка и конспект готовы' : 'Расшифровка готова';
  return `<span class="meeting-ai-action-status ready">✓ ${label}${time ? ` · ${escapeHtml(time)}` : ''}</span>`;
}

function cardMarkup(card) {
  const menu = `<button class="card-menu" aria-label="Действия с карточкой" title="Удалить">···</button>`;
  const imageTool = card.type === 'image' ? `<button class="image-settings" title="Настроить изображение" aria-label="Настроить изображение">⌁</button>` : '';
  const linkTool = card.type === 'links' ? `<button class="link-settings" title="Изменить ссылку" aria-label="Изменить ссылку">✎</button>` : '';
  const moveTool = editMode ? '<button class="drag-handle" type="button" aria-label="Переместить карточку" title="Потяните, чтобы переместить карточку или выделенную группу">⠿</button>' : '';
  const editTools = editMode ? `<div class="card-tools">${moveTool}${imageTool}${linkTool}${menu}</div>` : menu;
  const kicker = `<span class="card-kicker-label" ${editMode ? 'contenteditable="true" role="textbox" aria-label="Номер или метка карточки" title="Введите номер для сортировки, например 1"' : ''}>${escapeHtml(card.kicker || 'Заметка')}</span>`;
  const header = `<header class="card-header"><div><p class="card-kicker"><i></i>${kicker}</p><h2 ${editMode ? 'contenteditable="true"' : ''}>${escapeHtml(card.title || 'Без названия')}</h2></div>${editTools}</header>`;

  if (card.type === 'checklist') {
    const checked = card.items.filter(item => item.checked).length;
    const items = card.items.map((item, i) => `<li><label><input type="checkbox" data-item="${i}" ${item.checked ? 'checked' : ''}><span ${editMode ? 'contenteditable="true"' : ''}>${escapeHtml(item.text)}</span></label>${editMode ? `<button class="checklist-remove" type="button" data-item="${i}" aria-label="Удалить пункт" title="Удалить пункт">×</button>` : ''}</li>`).join('');
    return `${header}<div class="card-content"><ul class="checklist">${items}</ul>${editMode ? '<button class="checklist-add" type="button">+ Добавить пункт</button>' : ''}<div class="progress"><span style="width:${card.items.length ? checked / card.items.length * 100 : 0}%"></span></div><div class="meta-row"><span>${checked} из ${card.items.length} готово</span></div></div>`;
  }
  if (card.type === 'people') {
    const people = card.people.map(p => `<div class="person"><div class="person-avatar" style="background:${p.color}">${escapeHtml(p.initials)}</div><div><p>${escapeHtml(p.name)}</p><small>${escapeHtml(p.role)}</small></div></div>`).join('');
    return `${header}<div class="card-content">${people}</div>`;
  }
  if (card.type === 'links') {
    const links = card.links.map(l => `<a class="quick-link" href="${escapeAttr(l.url)}" target="_blank"><b>${escapeHtml(l.icon)}</b><span>${escapeHtml(l.label)}</span><em>↗</em></a>`).join('');
    return `${header}<div class="card-content link-list">${links}</div>`;
  }
  if (card.type === 'image') {
    const linked = Boolean(card.linkUrl);
    return `<div class="image-wrap ${linked ? 'has-link' : ''}" ${linked ? 'tabindex="0" role="link"' : ''} data-link="${escapeAttr(card.linkUrl || '')}"><img src="${escapeAttr(card.src)}" alt="${escapeAttr(card.title || 'Добавленное изображение')}" draggable="false" loading="lazy" decoding="async" style="object-fit:${card.imageFit || 'contain'}"><span class="image-zoom-indicator" aria-live="polite">100%</span>${linked ? '<button class="link-badge image-link-action" type="button" aria-label="Перейти по ссылке" title="Открыть в браузере">↗</button>' : ''}</div>${header}`;
  }
  if (card.type === 'transcript') {
    if (card.structured) card.structured = sanitizeRecap(card.structured);
    const pendingMessage = card.live ? 'Слушаю разговор — реплики появятся здесь.' : card.processing === 'error:missing_key' ? 'Подключите xAI или Groq через кнопку ✦ и повторите обработку.' : card.processing === 'error:invalid_key' ? 'Сохранённая строка не является API-ключом. Откройте ✦ и вставьте чистый ключ.' : 'Аудио сохранено. Расшифровка пока не получена.';
    const transcriptLines = String(card.transcript || '').split('\n').filter(Boolean);
    const text = card.transcript ? card.live ? `<div class="live-transcript-preview">${transcriptLines.slice(-5).map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div>` : `<details class="transcript-details"><summary>Полная расшифровка · ${transcriptLines.length || 1} реплик</summary><div>${escapeHtml(card.transcript).replace(/\n/g, '<br>')}</div></details>` : `<p class="transcript-pending">${pendingMessage}</p>`;
    const processing = meetingProcessingMarkup(card);
    const structured = structuredNotesMarkup(card);
    const suggestion = card.suggestedAnswer ? `<section class="hub-suggestion"><span>AI · ВАРИАНТ ОТВЕТА</span>${card.suggestedFor ? `<small>На вопрос: ${escapeHtml(card.suggestedFor)}</small>` : ''}<p>${escapeHtml(card.suggestedAnswer).replace(/\n/g, '<br>')}</p><button class="pin-suggestion" type="button" ${card.pinnedSuggestionId ? 'disabled' : ''}>${card.pinnedSuggestionId ? 'Уже закреплено' : 'Закрепить как шпаргалку'}</button></section>` : '';
    const legacyImportant = card.legacyImportant ? `<details class="legacy-important"><summary>Важное из прежней AI-карточки</summary><p>${escapeHtml(card.legacyImportant)}</p></details>` : '';
    const sourceTracks = card.sourceAudio && Object.keys(card.sourceAudio).length ? `<div class="source-tracks">${card.sourceAudio.mic ? `<label><span>Вы · микрофон</span><audio controls src="${escapeAttr(card.sourceAudio.mic)}"></audio></label>` : ''}${card.sourceAudio.system ? `<label><span>Собеседник · звук компьютера</span><audio controls src="${escapeAttr(card.sourceAudio.system)}"></audio></label>` : ''}</div>` : '';
    const aiBusy = ['transcribing','structuring'].includes(card.processing);
    const retry = card.audioSrc && (!card.transcript || String(card.processing || '').startsWith('error:')) ? `<button class="retry-transcript" type="button" ${aiBusy ? 'disabled' : ''}>${aiBusy ? 'Обрабатываю…' : card.aiProcessingStartedAt ? 'Повторить расшифровку и конспект' : 'Расшифровать и сделать конспект'}</button>` : '';
    const rebuildSummary = card.transcript ? `<button class="rebuild-summary" type="button" ${aiBusy ? 'disabled' : ''}>${card.processing === 'structuring' ? 'Обновляю конспект…' : card.structured ? 'Обновить конспект' : 'Сделать конспект'}</button>` : '';
    const aiActionStatus = meetingAiActionStatusMarkup(card);
    const setup = ['error:missing_key','error:invalid_key'].includes(card.processing) ? '<button class="open-ai-settings" type="button">Открыть настройки AI</button>' : '';
    if (card.meetingVersion) {
      const state = card.meetingState || 'paused';
      const tab = meetingTabs.get(card.id) || (state === 'finalized' ? 'summary' : 'now');
      const stateLabel = state === 'active' ? '● Идёт запись' : state === 'pausing' ? 'Сохраняю…' : state === 'paused' ? 'Ⅱ На паузе' : '✓ Завершена';
      const controls = state === 'active' ? '<button class="meeting-pause" type="button">Пауза</button><button class="meeting-finish" type="button">Завершить встречу</button>' : state === 'paused' ? '<button class="meeting-resume" type="button">Продолжить</button><button class="meeting-finish" type="button">Завершить встречу</button>' : state === 'finalized' ? '<button class="meeting-new" type="button">+ Новый разговор</button>' : '';
      const tabBar = `<nav class="meeting-tabs">${[['now','Сейчас'],['summary','Конспект'],['cheats','Шпаргалки'],['transcript','Расшифровка'],['audio','Аудио']].map(([id,label]) => `<button type="button" data-meeting-tab="${id}" class="${tab === id ? 'active' : ''}">${label}${id === 'cheats' && card.structured?.playbook?.length ? ` ${card.structured.playbook.length}` : ''}</button>`).join('')}</nav>`;
      const nowPane = `<div class="meeting-now"><div class="meeting-status ${state}">${stateLabel}${card.provider ? ` · ${escapeHtml(card.provider === 'azure' ? 'Azure Speech' : card.provider)}` : ''}</div>${card.transcript ? `<div class="live-transcript-preview">${transcriptLines.slice(-5).map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div>` : `<p class="transcript-pending">${pendingMessage}</p>`}${suggestion}</div>`;
      const readyCheats = card.structured?.playbook?.length ? `<div class="cheat-toolbar"><div><strong>Готовые шпаргалки</strong><small>${card.structured.playbook.length} блоков можно вынести из этой встречи</small></div><button class="publish-existing-cheats" type="button">Разложить на доске</button></div><div class="meeting-cheats">${card.structured.playbook.map(item => `<blockquote><b>${escapeHtml(item.cue)}</b><br>${escapeHtml(item.response)}</blockquote>`).join('')}</div>` : '<p class="meeting-empty">Готовых пар «вопрос → ответ» пока нет, но AI может сформировать экранные карточки из всего конспекта.</p>';
      const cheats = `${boardAiComposerMarkup(card)}${readyCheats}`;
      const markedMoments = meetingHighlightsMarkup(card);
      const segmentsAudio = (card.segments || []).map((segment,index) => `<section class="meeting-segment" data-segment-id="${escapeAttr(segment.id || '')}"><strong>Отрезок ${index + 1} · ${formatDuration(segment.durationSeconds || 0)}</strong>${segment.audioSrc ? `<audio controls src="${escapeAttr(segment.audioSrc)}"></audio>` : ''}${segment.sourceAudio?.mic || segment.sourceAudio?.system ? `<div class="source-tracks">${segment.sourceAudio.mic ? `<label><span>Вы · микрофон</span><audio controls src="${escapeAttr(segment.sourceAudio.mic)}"></audio></label>` : ''}${segment.sourceAudio.system ? `<label><span>Собеседники · звук компьютера</span><audio controls src="${escapeAttr(segment.sourceAudio.system)}"></audio></label>` : ''}</div>` : ''}</section>`).join('');
      const pane = tab === 'summary' ? (structured || '<p class="meeting-empty">Конспект появится после первых содержательных реплик.</p>') : tab === 'cheats' ? cheats : tab === 'transcript' ? (text || `<p class="transcript-pending">${pendingMessage}</p>`) : tab === 'audio' ? (segmentsAudio || '<p class="meeting-empty">Аудио появится после первой паузы.</p>') : nowPane;
      const languageSelect = `<select class="meeting-language" aria-label="Язык встречи" ${state === 'active' || state === 'pausing' ? 'disabled title="Язык можно изменить после паузы"' : ''}><option value="uk" ${card.meetingLanguage === 'uk' ? 'selected' : ''}>Українська</option><option value="ru" ${card.meetingLanguage === 'ru' ? 'selected' : ''}>Русский</option><option value="en" ${card.meetingLanguage === 'en' ? 'selected' : ''}>English</option></select>`;
      const boardAction = card.structured ? '<button class="open-board-ai" type="button">✦ Главное на доску</button>' : '';
      return `${header}<div class="meeting-hub-head"><span>${stateLabel}</span><div>${languageSelect}${boardAction}${controls}</div></div>${tabBar}<div class="card-content transcript-content meeting-pane">${processing}${pane}${markedMoments}<div class="transcript-actions">${setup}${retry}${rebuildSummary}${aiActionStatus}</div><div class="meta-row"><span>◷ ${escapeHtml(card.duration || '00:00')}</span><span>· ${(card.segments || []).length} отрезков</span></div></div>`;
    }
    return `${header}<div class="card-content transcript-content">${processing}${structured}${legacyImportant}${suggestion}${text}<div class="transcript-actions">${setup}${retry}${rebuildSummary}${aiActionStatus}</div>${sourceTracks}${card.audioSrc ? `<audio controls src="${escapeAttr(card.audioSrc)}"></audio>` : ''}<div class="meta-row"><span>◷ ${escapeHtml(card.duration || '00:00')}</span><span>· Локальная запись</span></div></div>`;
  }
  return `${header}<div class="card-content" ${editMode ? 'contenteditable="true"' : ''}>${card.content || '<p>Новая заметка</p>'}</div>`;
}

function resetImageZoomPreview() {
  const session = imageZoomPreview;
  if (!session) return;
  imageZoomPreview = null;
  session.cleanupPan?.();
  session.el?.classList.remove('image-zoom-preview', 'image-zoom-panning');
  session.image?.style.removeProperty('--image-zoom');
  session.image?.style.removeProperty('--image-pan-x');
  session.image?.style.removeProperty('--image-pan-y');
  if (session.indicator) {
    clearTimeout(session.indicator.zoomTimer);
    session.indicator.textContent = '100%';
    session.indicator.classList.remove('visible');
  }
  document.body.classList.remove('image-zoom-preview-active');
}

function applyImageZoomPreview(session) {
  session.image.style.setProperty('--image-zoom', String(session.zoom));
  session.image.style.setProperty('--image-pan-x', `${session.panX}px`);
  session.image.style.setProperty('--image-pan-y', `${session.panY}px`);
  if (session.indicator) {
    session.indicator.textContent = `${Math.round(session.zoom * 100)}%`;
    session.indicator.classList.add('visible');
    clearTimeout(session.indicator.zoomTimer);
    session.indicator.zoomTimer = setTimeout(() => session.indicator?.classList.remove('visible'), 850);
  }
}

function getImageZoomPreview(el, id) {
  const wrap = el.querySelector('.image-wrap');
  const image = wrap?.querySelector('img');
  if (!wrap || !image) return null;
  if (imageZoomPreview?.el === el) return imageZoomPreview;
  resetImageZoomPreview();
  imageZoomPreview = {
    id, el, wrap, image,
    indicator:wrap.querySelector('.image-zoom-indicator'),
    zoom:1, panX:0, panY:0, cleanupPan:null
  };
  el.classList.add('image-zoom-preview');
  document.body.classList.add('image-zoom-preview-active');
  applyImageZoomPreview(imageZoomPreview);
  return imageZoomPreview;
}

function beginImageZoomPan(event, el) {
  const session = imageZoomPreview;
  if (event.button !== 0 || !event.ctrlKey || !session || session.el !== el) return;
  event.preventDefault();
  event.stopPropagation();
  session.cleanupPan?.();
  const startX = event.clientX;
  const startY = event.clientY;
  const startPanX = session.panX;
  const startPanY = session.panY;
  let moved = false;
  const cleanup = () => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    el.classList.remove('image-zoom-panning');
    if (session.cleanupPan === cleanup) session.cleanupPan = null;
  };
  const onMove = moveEvent => {
    if (!moveEvent.ctrlKey || imageZoomPreview !== session) {
      resetImageZoomPreview();
      return;
    }
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 2) return;
    moved = true;
    moveEvent.preventDefault();
    el.classList.add('image-zoom-panning');
    session.panX = Math.round(startPanX + dx);
    session.panY = Math.round(startPanY + dy);
    applyImageZoomPreview(session);
  };
  const onUp = () => cleanup();
  session.cleanupPan = cleanup;
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
}

function bindCardEvents() {
  document.querySelectorAll('.card').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('.copy-summary')?.addEventListener('click', async event => {
      event.stopPropagation();
      const button = event.currentTarget;
      const card = cards.find(item => item.id === id);
      const text = structuredNotesText(card);
      if (!text) return;
      const result = await window.sloy?.copyText?.(text);
      if (!result?.ok) { showToast('Не удалось скопировать конспект'); return; }
      button.textContent = 'Скопировано ✓';
      showToast('Конспект скопирован как текст');
      setTimeout(() => { if (button.isConnected) button.textContent = 'Копировать конспект'; }, 1800);
    });
    el.addEventListener('click', event => {
      if (el.dataset.justDragged || !editMode || event.target.closest('button,input,a,[contenteditable="true"]')) return;
      selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
      el.classList.toggle('selected', selectedIds.has(id));
      updateSelectionBar();
    });
    el.querySelector('.card-menu')?.addEventListener('click', event => {
      event.stopPropagation();
      removeCard(id);
    });
    el.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', () => {
      const card = cards.find(c => c.id === id);
      card.items[Number(input.dataset.item)].checked = input.checked;
      saveCards('Чек-лист обновлён');
      render();
    }));
    el.querySelectorAll('.quick-link').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      openExternalLink(link.href);
    }));
    el.querySelector('h2[contenteditable]')?.addEventListener('input', event => {
      const card = cards.find(c => c.id === id);
      card.title = event.currentTarget.textContent.trim();
      debouncedSave();
    });
    const kicker = el.querySelector('.card-kicker-label[contenteditable]');
    kicker?.addEventListener('input', event => {
      const card = cards.find(c => c.id === id);
      card.kicker = event.currentTarget.textContent.trim();
      debouncedSave();
    });
    kicker?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.currentTarget.blur();
    });
    const content = el.querySelector('.card-content[contenteditable]');
    content?.addEventListener('input', event => {
      const card = cards.find(c => c.id === id);
      card.content = event.currentTarget.innerHTML;
      debouncedSave();
    });
    el.querySelectorAll('.checklist span[contenteditable]').forEach((span, index) => span.addEventListener('input', event => {
      const card = cards.find(c => c.id === id);
      card.items[index].text = event.currentTarget.textContent;
      debouncedSave();
    }));
    el.querySelector('.checklist-add')?.addEventListener('click', event => {
      event.stopPropagation();
      if (!editMode) return;
      const card = cards.find(c => c.id === id);
      if (!card || card.type !== 'checklist') return;
      card.items ||= [];
      card.items.push({ text:'Новый пункт', checked:false });
      saveCards('Пункт добавлен');
      render();
      requestAnimationFrame(() => {
        const rows = document.querySelectorAll(`[data-id="${CSS.escape(id)}"] .checklist span[contenteditable]`);
        const target = rows[rows.length - 1];
        target?.focus();
        if (target) document.getSelection()?.selectAllChildren(target);
      });
    });
    el.querySelectorAll('.checklist-remove').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      if (!editMode) return;
      const card = cards.find(c => c.id === id);
      const itemIndex = Number(button.dataset.item);
      if (!card || card.type !== 'checklist' || !Number.isInteger(itemIndex) || !card.items[itemIndex]) return;
      card.items.splice(itemIndex, 1);
      saveCards('Пункт удалён');
      render();
    }));
    el.querySelector('.image-settings')?.addEventListener('click', event => {
      event.stopPropagation();
      openImageDialog(id);
    });
    el.querySelector('.link-settings')?.addEventListener('click', event => {
      event.stopPropagation();
      openLinkDialog(id);
    });
    el.querySelector('.retry-transcript')?.addEventListener('click', async event => {
      event.stopPropagation();
      const card = cards.find(item => item.id === id);
      if (!card?.audioSrc || !window.sloy?.readAudio) return;
      if (['transcribing','structuring'].includes(card.processing)) {
        showToast('Обработка уже идёт · повторный запрос не отправлен');
        return;
      }
      card.aiLastAction = 'transcribe-summary';
      card.aiProcessingStartedAt = Date.now();
      card.processing = 'transcribing';
      persistWorkspaces();
      render();
      try {
        if (card.meetingVersion && card.segments?.length) {
          const space = workspaces.find(item => item.cards.includes(card)) || activeSpace();
          const manualSettings = { ...loadAiSettings(), autoTranscribe:true, autoStructure:false };
          const pendingSegments = card.segments.filter(item => item.audioSrc && !item.transcript);
          const segmentsToProcess = pendingSegments.length ? pendingSegments : [];
          if (!segmentsToProcess.length && !card.transcript) { card.processing = 'error:read'; render(); return; }
          for (const segment of segmentsToProcess) {
            const audio = await window.sloy.readAudio(segment.audioSrc);
            if (!audio?.ok) { card.processing = 'error:read'; card.aiLastFailedAt = Date.now(); persistWorkspaces(); render(); return; }
            await processMeetingSegmentWithAi(card, segment, audio.bytes, audio.mimeType, manualSettings, space.id);
            if (String(card.processing || '').startsWith('error:')) return;
          }
          card.transcript = aggregateMeetingTranscript(card);
          card.processing = '';
          persistWorkspaces();
          render();
          if (card.transcript) await rebuildMeetingSummary(card);
          return;
        }
        const audio = await window.sloy.readAudio(card.audioSrc);
        if (!audio?.ok) { card.processing = 'error:read'; render(); return; }
        await processRecordingWithAi(card, audio.bytes, audio.mimeType, { ...loadAiSettings(), autoTranscribe:true, autoStructure:true });
      } catch {
        card.processing = 'error:retry';
        card.aiLastFailedAt = Date.now();
        persistWorkspaces();
        render();
        showToast('Повторная обработка не удалась · локальное аудио сохранено');
      }
    });
    el.querySelector('.rebuild-summary')?.addEventListener('click', event => {
      event.stopPropagation();
      const card = cards.find(item => item.id === id);
      if (card && ['transcribing','structuring'].includes(card.processing)) {
        showToast('Обработка уже идёт · повторный запрос не отправлен');
        return;
      }
      if (card) void rebuildMeetingSummary(card);
    });
    el.querySelector('.open-ai-settings')?.addEventListener('click', event => {
      event.stopPropagation();
      document.getElementById('ai-settings-toggle')?.click();
    });
    el.querySelector('.pin-suggestion')?.addEventListener('click', event => {
      event.stopPropagation();
      const conversation = cards.find(item => item.id === id);
      if (conversation?.suggestedAnswer) pinConversationSuggestion(conversation);
    });
    el.querySelector('.open-board-ai')?.addEventListener('click', event => {
      event.stopPropagation();
      meetingTabs.set(id, 'cheats');
      render();
      requestAnimationFrame(() => document.querySelector(`[data-id="${CSS.escape(id)}"] .board-ai-instruction`)?.focus());
    });
    el.querySelector('.publish-existing-cheats')?.addEventListener('click', event => {
      event.stopPropagation();
      const meeting = cards.find(item => item.id === id);
      if (meeting) publishMeetingBoardCards(meeting, defaultMeetingBoardDrafts(meeting));
    });
    el.querySelector('.board-ai-composer')?.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      const meeting = cards.find(item => item.id === id);
      if (meeting) void requestMeetingBoardCards(meeting, event.currentTarget);
    });
    el.querySelectorAll('[data-meeting-tab]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      meetingTabs.set(id, button.dataset.meetingTab);
      render();
    }));
    el.querySelectorAll('.meeting-highlight').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      seekMeetingHighlight(id, button.dataset.segmentId, Number(button.dataset.offsetSeconds || 0));
    }));
    el.querySelector('.meeting-language')?.addEventListener('change', event => {
      event.stopPropagation();
      const card = cards.find(item => item.id === id);
      if (!card || !['uk','ru','en'].includes(event.currentTarget.value)) return;
      card.meetingLanguage = event.currentTarget.value;
      const settings = loadAiSettings();
      settings.transcriptionLanguage = card.meetingLanguage;
      safeJsonStorageSet('sloy.ai-settings', settings);
      persistWorkspaces();
      showToast(`Язык встречи: ${card.meetingLanguage === 'uk' ? 'украинский' : card.meetingLanguage === 'ru' ? 'русский' : 'английский'}`);
      if (card.transcript) void rebuildMeetingSummary(card);
    });
    el.querySelector('.meeting-pause')?.addEventListener('click', event => { event.stopPropagation(); stopRecording(); });
    el.querySelector('.meeting-resume')?.addEventListener('click', event => { event.stopPropagation(); void startRecording(false); });
    el.querySelector('.meeting-finish')?.addEventListener('click', event => {
      event.stopPropagation();
      if (recordingSession?.card?.id === id && !recordingSession.stopRequested) { recordingSession.finalizeAfterSave = true; stopRecording(); }
      else finalizeMeeting(id);
    });
    el.querySelector('.meeting-new')?.addEventListener('click', event => { event.stopPropagation(); void startRecording(true); });
    const imageWrap = el.querySelector('.image-wrap');
    el.querySelector('.image-link-action')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openExternalLink(imageWrap?.dataset.link || '');
    });
    imageWrap?.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || imageZoomPreview?.el === el) return;
      const link = event.currentTarget.dataset.link;
      if (link) openExternalLink(link);
    });
    imageWrap?.addEventListener('wheel', event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const session = getImageZoomPreview(el, id);
      if (!session) return;
      session.zoom = Math.max(.5, Math.min(4, Math.round((session.zoom + (event.deltaY < 0 ? .1 : -.1)) * 10) / 10));
      applyImageZoomPreview(session);
    }, { passive:false });
    imageWrap?.addEventListener('pointerdown', event => beginImageZoomPan(event, el));
    el.querySelectorAll('img').forEach(image => image.addEventListener('dragstart', event => event.preventDefault()));
    imageWrap?.addEventListener('keydown', event => {
      if (!editMode && ['Enter', ' '].includes(event.key) && event.currentTarget.dataset.link) {
        event.preventDefault();
        openExternalLink(event.currentTarget.dataset.link);
      }
    });
    if (activeSpace().view.layout === 'dashboard') {
      bindDirectDrag(el, id);
      if (editMode) bindLiveResize(el, id);
    } else {
      bindFlowFreeDrag(el, id);
      if (editMode) bindFlowResize(el, id);
    }
  });
}

async function rebuildMeetingSummary(card) {
  if (!card?.transcript || !window.sloy?.xaiStructure) return;
  if (['transcribing','structuring'].includes(card.processing)) {
    showToast('Обработка уже идёт · повторный запрос не отправлен');
    return;
  }
  const space = workspaces.find(item => item.cards.includes(card)) || activeSpace();
  const language = ['uk','ru','en'].includes(card.meetingLanguage) ? card.meetingLanguage : loadAiSettings().transcriptionLanguage;
  card.meetingLanguage = language;
  card.aiLastAction = 'summary';
  card.aiProcessingStartedAt = Date.now();
  card.processing = 'structuring';
  const operationId = beginCardAiProgress(card, 'Подготавливаю полный конспект');
  persistWorkspaces(); render();
  const revision = Number(card.revision || 0);
  const result = await window.sloy.xaiStructure({ transcript:card.transcript, language, workspaceContext:getWorkspaceContext(space.id), operationId });
  endCardAiProgress(operationId);
  if (revision !== Number(card.revision || 0)) return;
  if (result?.ok) {
    card.structured = mergeStructuredRecap(card, result.structured);
    card.structuredSource = 'ai';
    card.aiSummaryUpdatedAt = Date.now();
    delete card.aiLastFailedAt;
    card.processing = '';
    showToast('Конспект пересобран на выбранном языке');
    if (card.meetingState === 'finalized') {
      importMeetingToKnowledge(space, card);
    }
  } else {
    card.processing = `error:${result?.reason || 'structure'}`;
    card.aiLastFailedAt = Date.now();
    showToast('Не удалось обновить конспект · запись сохранена');
  }
  persistWorkspaces();
  if (space.id === activeSpaceId) render();
}

function finalizeMeeting(id) {
  const space = workspaces.find(item => item.cards.some(card => card.id === id));
  const card = space?.cards.find(item => item.id === id);
  if (!card || card.meetingState === 'active' || card.meetingState === 'pausing') return;
  card.meetingState = 'finalized';
  card.live = false;
  card.activeSegmentId = null;
  if (space.activeMeetingId === id) delete space.activeMeetingId;
  meetingTabs.set(id, 'summary');
  importMeetingToKnowledge(space, card);
  persistWorkspaces();
  syncDetachedMeetingWindow(card);
  if (space.id === activeSpaceId) render();
  showToast('Встреча завершена · следующая запись создаст новый разговор');
}

function pinConversationSuggestion(conversation) {
  if (conversation.pinnedSuggestionId && cards.some(card => card.id === conversation.pinnedSuggestionId)) return;
  const card = {
    id:crypto.randomUUID(), createdAt:Date.now(), type:'text', size:'small',
    accent:'#8177ef', kicker:'Шпаргалка', title:'Вариант ответа',
    content:`<p>${escapeHtml(conversation.suggestedAnswer).replace(/\n/g, '<br>')}</p>`,
    sourceSessionId:conversation.id, pinned:true
  };
  conversation.pinnedSuggestionId = card.id;
  cards.unshift(card);
  saveCards('Шпаргалка закреплена');
  render();
  showToast('Вариант ответа закреплён отдельной карточкой');
}

function defaultMeetingBoardDrafts(meeting) {
  const recap = sanitizeRecap(meeting?.structured);
  if (!recap) return [];
  const drafts = [];
  if (recap.keyPoints?.length) drafts.push({ title:'Самое важное', kicker:'AI · ГЛАВНОЕ', points:recap.keyPoints });
  (recap.playbook || []).slice(0,5).forEach(item => drafts.push({ title:item.cue, kicker:'ШПАРГАЛКА', points:[item.response] }));
  if (recap.tasks?.length) drafts.push({ title:'Следующие действия', kicker:'AI · ЗАДАЧИ', points:recap.tasks.slice(0,6).map(task => task.title) });
  if (recap.questions?.length && drafts.length < 8) drafts.push({ title:'Что уточнить', kicker:'AI · ВОПРОСЫ', points:recap.questions.slice(0,5) });
  return drafts.slice(0,8);
}

function publishMeetingBoardCards(meeting, drafts, instruction = '') {
  const space = workspaces.find(item => item.cards.includes(meeting));
  if (!space) return false;
  const normalized = (Array.isArray(drafts) ? drafts : []).map(item => ({
    title:recapText(item?.title),
    kicker:recapText(item?.kicker) || 'AI · ШПАРГАЛКА',
    points:recapList(item?.points, ['text', 'point'])
  })).filter(item => item.title && item.points.length).slice(0,8);
  if (!normalized.length) { showToast('AI не нашёл материала для отдельных шпаргалок'); return false; }
  const accents = ['#6d63e8','#ef6f72','#d59b2f','#2dbfae','#4b95e8','#9b6bd9','#e17c4d','#6477d8'];
  const previousIds = new Set(space.cards.filter(card => card.boardCheatSource === meeting.id).map(card => card.id));
  space.cards = space.cards.filter(card => !previousIds.has(card.id));
  const generated = normalized.map((item, index) => ({
    id:crypto.randomUUID(), createdAt:Date.now() + index, type:'text', size:item.points.length > 4 ? 'medium' : 'small',
    accent:accents[index % accents.length], kicker:item.kicker, title:item.title,
    content:`<ul class="board-cheat-list">${item.points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`,
    boardCheatSource:meeting.id, boardCheatInstruction:instruction, autoGenerated:true
  }));
  space.cards = [...generated, ...space.cards];
  meeting.boardCheatInstruction = instruction;
  if (space.id === activeSpaceId) cards = space.cards;
  persistWorkspaces();
  if (space.id === activeSpaceId) {
    render();
    requestAnimationFrame(() => document.querySelector(`[data-id="${CSS.escape(generated[0].id)}"]`)?.scrollIntoView({ behavior:'smooth', block:'center', inline:'center' }));
  }
  showToast(`${generated.length} шпаргалок размещено на доске`);
  return true;
}

async function requestMeetingBoardCards(meeting, form) {
  const instructionInput = form.querySelector('.board-ai-instruction');
  const status = form.querySelector('.board-ai-status');
  const submit = form.querySelector('button[type="submit"]');
  const instruction = instructionInput.value.trim() || 'Выдели главные шпаргалки, которые полезно одновременно держать на экране.';
  if (!meeting.transcript && !meeting.structured) { status.textContent = 'Сначала нужна расшифровка или конспект.'; return; }
  if (!window.sloy?.xaiBoardCheats) { status.textContent = 'AI-функция недоступна в этой версии.'; return; }
  meeting.boardCheatInstruction = instruction;
  persistWorkspaces();
  submit.disabled = true;
  status.textContent = 'AI отбирает главное и проектирует карточки…';
  const space = workspaces.find(item => item.cards.includes(meeting)) || activeSpace();
  try {
    const result = await window.sloy.xaiBoardCheats({
      transcript:meeting.transcript || '', structured:meeting.structured || {}, instruction,
      context:getWorkspaceContext(space.id), language:meeting.meetingLanguage || loadAiSettings().transcriptionLanguage || 'uk'
    });
    if (result?.ok && result.cards?.length) {
      publishMeetingBoardCards(meeting, result.cards, instruction);
      return;
    }
    status.textContent = result?.reason === 'missing_key'
      ? 'Подключите xAI или Groq через ✦ внизу боковой панели.'
      : result?.reason === 'http_413'
        ? 'Провайдер отклонил даже компактный запрос. Готовые блоки выше можно вынести на доску без AI.'
        : `Не удалось сформировать карточки: ${result?.reason || 'ошибка'}`;
  } catch {
    status.textContent = 'AI сейчас недоступен. Готовые шпаргалки выше можно вынести без AI.';
  } finally {
    submit.disabled = false;
  }
}

function bindDirectDrag(el, id) {
  el.addEventListener('pointerdown', event => {
    const dragHandle = event.target.closest('.drag-handle');
    if (event.button !== 0 || (!dragHandle && event.target.closest('button,input,select,textarea,a,audio,[contenteditable="true"],.resize-handle,.structured-notes,.transcript-details,.live-transcript-preview,.meeting-cheats'))) return;
    const card = cards.find(item => item.id === id);
    if (!card?.position) return;
    const undoState = captureCardLayoutState();
    const targets = draggedCardsFor(id);
    const starts = targets.map(item => ({ item, x:item.position.x, y:item.position.y }));
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      el.classList.remove('direct-dragging');
      clearSpaceDropTarget();
    };
    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; el.classList.add('direct-dragging'); }
      moveEvent.preventDefault();
      starts.forEach(({ item, x, y }) => {
        item.position.x = Math.max(0, Math.min(x + dx, board.clientWidth - item.position.w));
        item.position.y = Math.max(0, Math.min(y + dy, board.clientHeight - item.position.h));
        const targetEl = board.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
        if (targetEl) { targetEl.style.left = `${item.position.x}px`; targetEl.style.top = `${item.position.y}px`; }
      });
      crossSpaceDropTargetAtPoint(moveEvent.clientX, moveEvent.clientY, targets);
    };
    const onUp = upEvent => {
      const drop = moved && upEvent.type !== 'pointercancel' ? crossSpaceDropTargetAtPoint(upEvent.clientX, upEvent.clientY, targets) : null;
      if (drop) starts.forEach(({ item, x, y }) => { item.position.x = x; item.position.y = y; });
      cleanup();
      if (drop) {
        if (!drop.blocked) moveCardsToWorkspace(drop.spaceId, targets);
        else showToast('Эту встречу нельзя переносить, пока она активна или обрабатывается');
        return;
      }
      if (upEvent.type === 'pointercancel') {
        starts.forEach(({ item, x, y }) => { item.position.x = x; item.position.y = y; });
        render();
        return;
      }
      if (moved && upEvent.type !== 'pointercancel') {
        pushCardLayoutUndo(targets.length > 1 ? 'Перемещение группы' : 'Перемещение карточки', undoState);
        el.dataset.justDragged = 'true';
        setTimeout(() => delete el.dataset.justDragged, 80);
        saveCards(targets.length > 1 ? 'Группа перемещена' : 'Положение сохранено');
      }
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
}

function bindFlowFreeDrag(el, id) {
  el.addEventListener('pointerdown', event => {
    const dragHandle = event.target.closest('.drag-handle');
    if (event.button !== 0 || (!dragHandle && event.target.closest('button,input,select,textarea,a,audio,[contenteditable="true"],.structured-notes,.transcript-details,.live-transcript-preview,.meeting-cheats'))) return;
    const card = cards.find(item => item.id === id);
    if (!card) return;
    const transferTargets = draggedCardsFor(id);
    const undoState = captureCardLayoutState();
    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollLeft = board.scrollLeft;
    const startScrollTop = board.scrollTop;
    const startOffsetX = Number(card.flowOffsetX) || 0;
    const startOffsetY = Number(card.flowOffsetY) || 0;
    const startLayer = Number(card.flowLayer) || 0;
    let moved = false;
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      el.classList.remove('flow-reordering');
      clearSpaceDropTarget();
    };
    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX + (board.scrollLeft - startScrollLeft);
      const dy = moveEvent.clientY - startY + (board.scrollTop - startScrollTop);
      if (!moved && Math.hypot(dx, dy) < 1) return;
      if (!moved) {
        moved = true;
        el.classList.add('flow-reordering');
        card.flowLayer = Math.max(1, ...cards.map(item => Number(item.flowLayer) || 0)) + 1;
        el.style.zIndex = String(card.flowLayer);
        document.getSelection()?.removeAllRanges();
      }
      moveEvent.preventDefault();
      card.flowOffsetX = Math.round(startOffsetX + dx);
      card.flowOffsetY = Math.round(startOffsetY + dy);
      el.style.left = `${card.flowOffsetX}px`;
      el.style.top = `${card.flowOffsetY}px`;
      const boardRect = board.getBoundingClientRect();
      if (moveEvent.clientY > boardRect.bottom - 72) board.scrollTop += 22;
      else if (moveEvent.clientY < boardRect.top + 72) board.scrollTop -= 22;
      if (moveEvent.clientX > boardRect.right - 72) board.scrollLeft += 22;
      else if (moveEvent.clientX < boardRect.left + 72) board.scrollLeft -= 22;
      crossSpaceDropTargetAtPoint(moveEvent.clientX, moveEvent.clientY, transferTargets);
    };
    const onUp = upEvent => {
      const drop = moved && upEvent.type !== 'pointercancel' ? crossSpaceDropTargetAtPoint(upEvent.clientX, upEvent.clientY, transferTargets) : null;
      if (drop) {
        card.flowOffsetX = startOffsetX;
        card.flowOffsetY = startOffsetY;
        card.flowLayer = startLayer;
      }
      cleanup();
      if (!moved) return;
      if (drop) {
        if (!drop.blocked) moveCardsToWorkspace(drop.spaceId, transferTargets);
        else { render(); showToast('Эту встречу нельзя переносить, пока она активна или обрабатывается'); }
        return;
      }
      if (upEvent.type === 'pointercancel') {
        card.flowOffsetX = startOffsetX;
        card.flowOffsetY = startOffsetY;
        card.flowLayer = startLayer;
        render();
        return;
      }
      activeSpace().view.sort = 'manual';
      pushCardLayoutUndo('Перемещение карточки', undoState);
      el.dataset.justDragged = 'true';
      setTimeout(() => delete el.dataset.justDragged, 80);
      saveCards('Положение карточки сохранено');
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
}

function bindFlowResize(el, id) {
  const handle = el.querySelector('.resize-handle');
  if (!handle) return;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const card = cards.find(item => item.id === id);
    if (!card) return;
    const undoState = captureCardLayoutState();
    const layout = activeSpace().view.layout;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = el.getBoundingClientRect();
    const styles = getComputedStyle(board);
    const columnGap = parseFloat(styles.columnGap) || 12;
    const rowGap = parseFloat(styles.rowGap) || 12;
    const startColumns = Math.max(1, Math.min(3, Number(card.flowColumns) || 1));
    const startRows = Math.max(2, Math.min(10, Number(card.flowRows) || 4));
    const startHeight = Math.max(90, Number(card.flowHeight) || rect.height);
    const columnPitch = (rect.width - columnGap * (startColumns - 1)) / startColumns + columnGap;
    const rowSize = parseFloat(styles.gridAutoRows) || 66;
    const rowPitch = rowSize + rowGap;
    let changed = false;
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      handle.classList.remove('resizing');
    };
    const onMove = moveEvent => {
      moveEvent.preventDefault();
      handle.classList.add('resizing');
      if (layout === 'gallery') {
        const maxColumns = Math.max(1, Math.min(3, Math.floor((board.clientWidth + columnGap) / Math.max(1, columnPitch))));
        const columns = Math.max(1, Math.min(maxColumns, Math.round((rect.width + moveEvent.clientX - startX + columnGap) / columnPitch)));
        const rows = Math.max(2, Math.min(10, Math.round((rect.height + moveEvent.clientY - startY + rowGap) / rowPitch)));
        changed ||= columns !== startColumns || rows !== startRows;
        card.flowColumns = columns;
        card.flowRows = rows;
        el.style.setProperty('--flow-columns', String(columns));
        el.style.setProperty('--flow-rows', String(rows));
      } else {
        const height = Math.max(90, Math.min(720, Math.round(startHeight + moveEvent.clientY - startY)));
        changed ||= height !== startHeight;
        card.flowHeight = height;
        el.style.setProperty('--flow-list-height', `${height}px`);
      }
    };
    const onUp = () => {
      cleanup();
      if (changed) {
        pushCardLayoutUndo('Изменение размера карточки', undoState);
        saveCards('Размер карточки сохранён');
      }
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
}

function bindLiveResize(el, id) {
  const handle = el.querySelector('.resize-handle');
  if (!handle) return;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const card = cards.find(item => item.id === id);
    if (!card?.position) return;
    const undoState = captureCardLayoutState();
    const targets = selectedIds.has(id) && selectedIds.size > 1 ? cards.filter(item => selectedIds.has(item.id)) : [card];
    const starts = targets.map(item => ({ item, w:item.position.w, h:item.position.h }));
    const startX = event.clientX;
    const startY = event.clientY;
    let changed = false;
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };
    const onMove = moveEvent => {
      const dw = moveEvent.clientX - startX;
      const dh = moveEvent.clientY - startY;
      if (Math.hypot(dw, dh) >= 2) changed = true;
      moveEvent.preventDefault();
      starts.forEach(({ item, w, h }) => {
        item.position.w = Math.max(160, Math.min(w + dw, board.clientWidth - item.position.x));
        item.position.h = Math.max(110, Math.min(h + dh, board.clientHeight - item.position.y));
        const targetEl = board.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
        if (targetEl) { targetEl.style.width = `${item.position.w}px`; targetEl.style.height = `${item.position.h}px`; }
      });
    };
    const onUp = () => {
      cleanup();
      if (!changed) return;
      pushCardLayoutUndo(targets.length > 1 ? 'Изменение размера группы' : 'Изменение размера карточки', undoState);
      saveCards(targets.length > 1 ? 'Размер группы сохранён' : 'Размер сохранён');
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
}

let saveTimer;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveCards('Изменения сохранены');
  }, 650);
}

function flushDebouncedSave(message = 'Изменения сохранены') {
  if (!saveTimer) return true;
  clearTimeout(saveTimer);
  saveTimer = null;
  return saveCards(message);
}

function removeCard(id) {
  const index = cards.findIndex(card => card.id === id);
  if (index < 0) return;
  const removed = cards.splice(index, 1)[0];
  const historyEntry = { card:removed, index, spaceId:activeSpace().id, removedAt:Date.now() };
  deletedCardHistory.push(historyEntry);
  if (deletedCardHistory.length > MAX_DELETED_CARD_HISTORY) deletedCardHistory.shift();
  pushCardUndo({ type:'delete', label:'Удаление карточки', spaceId:activeSpace().id, deletedEntry:historyEntry });
  selectedIds.delete(id);
  saveCards('Карточка удалена');
  render();
  showToast('Карточка удалена', {
    duration:3500,
    actionLabel:'Вернуть',
    onAction:() => restoreDeletedCard(historyEntry)
  });
}

function restoreDeletedCard(entry = deletedCardHistory[deletedCardHistory.length - 1]) {
  if (!entry) return false;
  const space = workspaces.find(item => item.id === entry.spaceId);
  if (!space || space.cards.some(card => card.id === entry.card.id)) {
    const staleIndex = deletedCardHistory.indexOf(entry);
    if (staleIndex >= 0) deletedCardHistory.splice(staleIndex, 1);
    return false;
  }
  const targetIndex = Math.max(0, Math.min(Number(entry.index) || 0, space.cards.length));
  space.cards.splice(targetIndex, 0, entry.card);
  const historyIndex = deletedCardHistory.indexOf(entry);
  if (historyIndex >= 0) deletedCardHistory.splice(historyIndex, 1);
  for (let index = cardUndoHistory.length - 1; index >= 0; index--) {
    if (cardUndoHistory[index].type === 'delete' && cardUndoHistory[index].deletedEntry === entry) cardUndoHistory.splice(index, 1);
  }
  if (space.id === activeSpaceId) cards = space.cards;
  persistWorkspaces();
  renderSpaces();
  if (space.id === activeSpaceId) render();
  showToast(space.id === activeSpaceId ? 'Карточка возвращена' : `Карточка возвращена в «${space.title}»`);
  return true;
}

function addCard(type) {
  if (type === 'image') { imageInput.click(); return; }
  if (type === 'link') { addMenu.hidden = true; openLinkDialog(); return; }
  const id = `card-${Date.now()}`;
  const base = { id, createdAt:Date.now(), type, size: type === 'checklist' ? 'medium' : 'small', accent: randomAccent(), kicker: type === 'link' ? 'Ссылка' : 'Новое', title: type === 'checklist' ? 'Новый список' : type === 'link' ? 'Полезная ссылка' : 'Новая заметка' };
  if (type === 'checklist') base.items = [{ text: 'Первый пункт', checked: false }, { text: 'Ещё один пункт', checked: false }];
  else base.content = '<p>Нажмите «Править» и добавьте сюда то, что важно держать под рукой.</p>';
  cards.unshift(base);
  saveCards('Карточка добавлена');
  render();
  setEditMode(true);
  addMenu.hidden = true;
}

function setEditMode(enabled) {
  editMode = enabled;
  if (!enabled) selectedIds.clear();
  document.body.classList.toggle('edit-mode', enabled);
  document.querySelectorAll('.view-toggle').forEach(button => button.classList.toggle('active', button.dataset.view === (enabled ? 'edit' : 'view')));
  const editButton = document.querySelector('[data-view="edit"]');
  editButton.querySelector('em').textContent = enabled ? 'Готово' : 'Править';
  editButton.setAttribute('aria-label', enabled ? 'Готово' : 'Править');
  render();
}

function updateSelectionBar() {
  const bar = document.querySelector('#selection-bar');
  const visible = editMode && activeSpace().view.layout === 'dashboard' && selectedIds.size > 0;
  bar.hidden = !visible;
  document.querySelector('#selection-count').textContent = selectedIds.size;
}

function applyGroupSize(size) {
  const targets = cards.filter(card => selectedIds.has(card.id));
  const dimensions = {
    small:{ w:240, h:170 },
    medium:{ w:340, h:240 },
    wide:{ w:500, h:250 },
    large:{ w:520, h:360 }
  }[size];
  if (!targets.length) return;
  const undoState = captureCardLayoutState();
  targets.forEach(card => {
    card.size = size;
    card.position.w = dimensions.w;
    card.position.h = dimensions.h;
  });
  pushCardLayoutUndo('Изменение размера группы', undoState);
  saveCards(`Одинаковый размер применён к ${targets.length} карточкам`);
  render();
}

function arrangeSelected(mode) {
  const targets = cards.filter(card => selectedIds.has(card.id)).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  if (targets.length < 2) { showToast('Выберите хотя бы два объекта'); return; }
  const undoState = captureCardLayoutState();
  const gap = 14;
  const startX = Math.min(...targets.map(card => card.position.x));
  const startY = Math.min(...targets.map(card => card.position.y));
  if (mode === 'row') {
    let x = startX;
    targets.forEach(card => { card.position.x = x; card.position.y = startY; x += card.position.w + gap; });
  } else if (mode === 'column') {
    let y = startY;
    targets.forEach(card => { card.position.x = startX; card.position.y = y; y += card.position.h + gap; });
  } else {
    const columns = Math.ceil(Math.sqrt(targets.length));
    const cellW = Math.max(...targets.map(card => card.position.w)) + gap;
    const cellH = Math.max(...targets.map(card => card.position.h)) + gap;
    targets.forEach((card, index) => {
      card.position.x = startX + (index % columns) * cellW;
      card.position.y = startY + Math.floor(index / columns) * cellH;
    });
  }
  pushCardLayoutUndo('Расположение карточек', undoState);
  saveCards('Выделенные объекты расположены');
  render();
}

function filterCards(query) {
  const term = query.trim().toLocaleLowerCase('ru');
  let visible = 0;
  document.querySelectorAll('.card').forEach(el => {
    const card = cards.find(c => c.id === el.dataset.id);
    const haystack = JSON.stringify(card).toLocaleLowerCase('ru');
    const match = !term || haystack.includes(term);
    el.classList.toggle('hidden-by-search', !match);
    if (match) visible++;
  });
  const empty = document.querySelector('#empty-search');
  empty.hidden = visible > 0;
  if (!visible) {
    empty.querySelector('h2').textContent = term ? 'Ничего не найдено' : 'Здесь пока свободно';
    empty.querySelector('p').textContent = term ? 'Попробуйте другое слово или очистите поиск.' : 'Нажмите «Добавить» или вставьте текст и скриншот через Ctrl+V.';
  }
}

function showToast(message, { duration = 1800, actionLabel = '', onAction = null } = {}) {
  clearTimeout(showToast.timer);
  toast.replaceChildren(document.createTextNode(message));
  if (actionLabel && typeof onAction === 'function') {
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      clearTimeout(showToast.timer);
      onAction();
    }, { once:true });
    toast.append(' ', action);
  }
  toast.classList.add('show');
  showToast.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function randomAccent() {
  return ['#7065e8', '#45a7a0', '#e17e68', '#627fc0', '#9b77bc'][Math.floor(Math.random() * 5)];
}

function openSpaceDialog() {
  document.querySelector('#space-name').value = '';
  spaceDialog.showModal();
  setTimeout(() => document.querySelector('#space-name').focus(), 30);
}

function openImageDialog(id) {
  const card = cards.find(item => item.id === id);
  if (!card || card.type !== 'image') return;
  editingImageId = id;
  document.querySelector('#image-dialog-preview').src = card.src;
  document.querySelector('#image-title').value = card.title || '';
  document.querySelector('#image-link').value = card.linkUrl || '';
  document.querySelector('#image-fit').value = card.imageFit || 'contain';
  document.querySelector('#image-dialog').showModal();
}

function openLinkDialog(id = null) {
  const card = id ? cards.find(item => item.id === id) : null;
  if (id && (!card || card.type !== 'links')) return;
  const link = card?.links?.[0];
  editingLinkId = card?.id || null;
  document.querySelector('#link-dialog-title').textContent = card ? 'Изменить ссылку' : 'Новая ссылка';
  document.querySelector('#link-label').value = link?.label || card?.title || '';
  document.querySelector('#link-url').value = link?.url || '';
  document.querySelector('#link-dialog').showModal();
  setTimeout(() => document.querySelector(card ? '#link-label' : '#link-url').focus(), 30);
}

function normalizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/\s|[\u0000-\u001f\u007f]/.test(raw)) return '';
  try {
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
    const url = new URL(hasScheme ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return '';
    return url.href;
  } catch { return ''; }
}

async function openExternalLink(value) {
  const url = normalizeExternalUrl(value);
  if (!url) { showToast('Некорректная ссылка'); return; }
  if (window.sloy?.openExternal) {
    try {
      const result = await window.sloy.openExternal(url);
      if (!result?.ok) showToast('Не удалось открыть ссылку');
    } catch {
      showToast('Не удалось открыть браузер');
    }
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

function createSpace(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;
  const words = cleanTitle.split(/\s+/);
  const glyph = words.slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('ru');
  const space = { id: crypto.randomUUID(), title: cleanTitle, glyph: glyph || '•', view:{ layout:'dashboard', sort:'manual' }, cards: [] };
  workspaces.push(space);
  activeSpaceId = space.id;
  cards = space.cards;
  saveCards('Пространство создано');
  render();
}

async function addImageFile(file, title = '') {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 20 * 1024 * 1024) { showToast('Изображение больше 20 МБ'); return; }
  try {
    const bytes = await file.arrayBuffer();
    let src;
    if (window.sloy?.saveAsset) {
      const extension = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const saved = await window.sloy.saveAsset({ bytes, extension });
      if (!saved?.url) throw new Error('asset_save');
      src = saved.url;
    } else {
      src = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('file_read'));
        reader.readAsDataURL(file);
      });
    }
    const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    cards.unshift({ id:crypto.randomUUID(), createdAt:Date.now(), type:'image', size:'wide', accent:'#627fc0', kicker:'Скриншот', title:title || file.name?.replace(/\.[^.]+$/, '') || `Скриншот · ${time}`, src, linkUrl:'', imageFit:'contain' });
    search.value = '';
    saveCards('Изображение добавлено из буфера');
    render();
  } catch {
    showToast('Не удалось сохранить изображение · попробуйте ещё раз');
  }
}

function addPastedText(text) {
  const clean = text.trim();
  if (!clean) return;
  if (/^https?:\/\/\S+$/i.test(clean)) {
    const host = new URL(clean).hostname.replace(/^www\./, '');
    cards.unshift({ id:crypto.randomUUID(), createdAt:Date.now(), type:'links', size:'small', accent:'#627fc0', kicker:'Ссылка', title:host, links:[{ icon:'↗', label:clean, url:clean }] });
  } else {
    const lines = clean.split(/\r?\n/).filter(Boolean);
    const title = (lines.shift() || 'Вставленный текст').slice(0, 80);
    const body = lines.length ? lines : [title];
    cards.unshift({ id:crypto.randomUUID(), createdAt:Date.now(), type:'text', size:clean.length > 280 ? 'large' : 'medium', accent:randomAccent(), kicker:'Из буфера', title, content:body.map(line => `<p>${escapeHtml(line)}</p>`).join('') });
  }
  search.value = '';
  saveCards('Добавлено из буфера');
  render();
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function resampleToPcm16(input, inputRate) {
  const ratio = inputRate / 16000;
  const output = new Int16Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let index = 0; index < output.length; index++) {
    const sample = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)] || 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function createSourceRecording(stream, sourceName, options) {
  const sourceStream = new MediaStream(stream.getAudioTracks());
  const recorder = new MediaRecorder(sourceStream, options);
  const chunks = [];
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  let resolved = false;
  const finish = () => {
    if (resolved) return;
    resolved = true;
    resolveDone(new Blob(chunks, { type:recorder.mimeType || 'audio/webm' }));
  };
  recorder.onstop = finish;
  recorder.onerror = finish;
  recorder.start(2000);
  return { sourceName, recorder, done, finish };
}

async function attachLivePcm(stream, sourceName) {
  const context = new AudioContext();
  await context.resume();
  if (context.state !== 'running') throw new Error('audio_context_suspended');
  const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  processor.onaudioprocess = event => {
    if (!liveSttSessionId) return;
    const pcm = resampleToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate);
    window.sloy?.sendXaiAudio({ sessionId:liveSttSessionId, source:sourceName, bytes:pcm.buffer });
  };
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(context.destination);
  liveCaptureNodes.push({ context, source, processor, silentGain });
}

function pcm16ToWav(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44;
  chunks.forEach(chunk => { for (let index = 0; index < chunk.length; index++, offset += 2) view.setInt16(offset, chunk[index], true); });
  return bytes;
}

async function attachGroqLivePcm(stream, sourceName) {
  const context = new AudioContext();
  await context.resume();
  if (context.state !== 'running') throw new Error('audio_context_suspended');
  const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  processor.onaudioprocess = event => {
    if (liveProvider !== 'groq') return;
    groqLiveBuffers[sourceName].push(resampleToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate));
  };
  source.connect(processor); processor.connect(silentGain); silentGain.connect(context.destination);
  liveCaptureNodes.push({ context, source, processor, silentGain });
}

function appendGroqTranscript(source, text) {
  const clean = String(text || '').trim();
  const now = Date.now();
  if (!clean || clean === liveLastFinal[source] && now - liveLastFinalAt[source] < 2500) return;
  liveLastFinal[source] = clean;
  liveLastFinalAt[source] = now;
  const added = appendLiveUtterance(source, clean);
  if (!added) return;
  if (recordingSession?.card) recordingSession.card.processing = 'live:listening';
  document.querySelector('#record-transcript').textContent = transcriptText;
  updateLiveOutline();
  if (liveSuggestionsEnabled()) scheduleLiveSuggestion(clean, source);
}

function updateLiveOutline() {
  const outline = document.getElementById('live-outline-panel');
  const content = document.getElementById('live-outline');
  const recap = buildLocalSummary(transcriptText);
  if (!recap) { outline.hidden = true; return; }
  outline.hidden = false;
  const points = recap.keyPoints.slice(-4).map(point => `<li>${escapeHtml(point)}</li>`).join('');
  const tasks = recap.tasks.slice(-2).map(task => `<li><b>Задача:</b> ${escapeHtml(task.title)}</li>`).join('');
  content.innerHTML = `<ul>${points}${tasks}</ul>`;
  syncLiveSessionCards();
}

async function flushGroqLiveSource(sourceName, force = false) {
  if (groqLiveBusy[sourceName] || !groqLiveBuffers[sourceName].length || !window.sloy?.transcribeGroqChunk) return;
  const chunks = groqLiveBuffers[sourceName].splice(0);
  const samples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (samples < 8000 && !force) { groqLiveBuffers[sourceName].unshift(...chunks); return; }
  groqLiveBusy[sourceName] = true;
  const expectedSession = recordingSession;
  const expectedSessionId = liveSttSessionId;
  try {
    const result = await window.sloy.transcribeGroqChunk({ bytes:pcm16ToWav(chunks), language:liveLanguage });
    if (recordingSession !== expectedSession || liveSttSessionId !== expectedSessionId) return;
    if (result?.ok) appendGroqTranscript(sourceName, result.text);
    else {
      const reason = result?.reason || 'unknown';
      const prefix = recordingSession?.coachOnly ? 'Помощник слушает' : 'Аудио пишется';
      document.querySelector('#record-status').textContent = reason === 'missing_key' ? `${prefix} · добавьте ключ AI в ✦` : reason === 'http_401' ? `${prefix} · ключ Groq отклонён` : reason === 'http_429' ? `${prefix} · лимит Groq исчерпан` : `${prefix} · ошибка распознавания (${reason})`;
      if (recordingSession?.card) recordingSession.card.processing = `error:${reason}`;
    }
  } finally { groqLiveBusy[sourceName] = false; }
}

async function startGroqLiveTranscription(microphoneStream, systemStream) {
  liveProvider = 'groq';
  liveSttSessionId = `groq-${Date.now()}`;
  liveHasSystemSource = Boolean(systemStream?.getAudioTracks().length);
  groqLiveBuffers.mic = []; groqLiveBuffers.system = [];
  liveInterim.mic = liveInterim.system = '';
  liveLastFinal.mic = liveLastFinal.system = '';
  resetLiveSuggestionTurns();
  await attachGroqLivePcm(microphoneStream, 'mic');
  if (systemStream?.getAudioTracks().length) await attachGroqLivePcm(systemStream, 'system');
  groqLiveInterval = setInterval(() => {
    void flushGroqLiveSource('mic');
    if (systemStream?.getAudioTracks().length) void flushGroqLiveSource('system');
  }, 7000);
  document.querySelector('#record-status').textContent = 'Groq расшифровывает разговор каждые несколько секунд';
  return true;
}

async function startLiveTranscription(settings, microphoneStream, systemStream) {
  if (!settings.liveTranscription || !window.sloy?.startXaiStream) return false;
  const status = await window.sloy.xaiKeyStatus();
  if (!status?.configured) {
    const prefix = recordingSession?.coachOnly ? 'AI-помощник' : 'Записываю аудио';
    document.querySelector('#record-status').textContent = status?.invalidStoredKey ? `${prefix} · сохранённая строка не является API-ключом` : `${prefix} · добавьте ключ xAI или Groq в ✦`;
    if (recordingSession?.card) recordingSession.card.processing = status?.invalidStoredKey ? 'error:invalid_key' : 'error:missing_key';
    document.getElementById('live-suggestion').textContent = status?.invalidStoredKey ? 'Сохранённая строка не является API-ключом. Откройте ✦.' : 'Подключите xAI или Groq через ✦, чтобы получать варианты ответа.';
    return false;
  }
  liveLanguage = settings.transcriptionLanguage || 'auto';
  if (status.providers?.azure) {
    const sources = ['mic'];
    if (systemStream?.getAudioTracks().length) sources.push('system');
    liveHasSystemSource = sources.includes('system');
    const result = await window.sloy.startAzureStream({ sources, language:liveLanguage });
    if (!result?.ok) {
      document.querySelector('#record-status').textContent = `Azure Speech не подключился · ${result?.reason || 'ошибка'}`;
    } else {
      liveSttSessionId = result.sessionId;
      liveProvider = 'azure';
      liveInterim.mic = liveInterim.system = '';
      liveLastFinal.mic = liveLastFinal.system = '';
      await attachLivePcm(microphoneStream, 'mic');
      if (sources.includes('system')) await attachLivePcm(systemStream, 'system');
      document.querySelector('#record-status').textContent = sources.length > 1 ? 'Azure Speech слушает вас и системный звук' : 'Azure Speech расшифровывает микрофон';
      return true;
    }
  }
  if (status.providers?.xai) {
    const sources = ['mic'];
    if (systemStream?.getAudioTracks().length) sources.push('system');
    liveHasSystemSource = sources.includes('system');
    const result = await window.sloy.startXaiStream({ sources, language:liveLanguage });
    if (result?.ok) {
      liveSttSessionId = result.sessionId;
      liveProvider = 'xai';
      liveInterim.mic = liveInterim.system = '';
      liveLastFinal.mic = liveLastFinal.system = '';
      await attachLivePcm(microphoneStream, 'mic');
      if (sources.includes('system')) await attachLivePcm(systemStream, 'system');
      document.querySelector('#record-status').textContent = sources.length > 1 ? 'Grok слушает вас и собеседника' : 'Grok расшифровывает микрофон';
      return true;
    }
  }
  if (status.providers?.groq) return startGroqLiveTranscription(microphoneStream, systemStream);
  return false;
}

async function stopLiveTranscription() {
  const provider = liveProvider;
  const sessionId = liveSttSessionId;
  try {
    const stopWork = (async () => {
      if (provider === 'groq') {
        clearInterval(groqLiveInterval);
        groqLiveInterval = null;
        await Promise.all([flushGroqLiveSource('mic', true), flushGroqLiveSource('system', true)]);
      }
      if (['xai','azure'].includes(provider) && sessionId) await window.sloy?.stopXaiStream(sessionId);
    })();
    await window.SloyRecordingRuntime.withDeadline(stopWork, 5000, null);
  } catch {
    // The local recording must still be saved even if the live connection ended badly.
  } finally {
    liveCaptureNodes.forEach(({ context, source, processor, silentGain }) => {
      try { processor.disconnect(); source.disconnect(); silentGain.disconnect(); context.close(); } catch {}
    });
    liveCaptureNodes = [];
    liveSttSessionId = null;
    liveProvider = '';
    liveHasSystemSource = false;
  }
}

window.sloy?.onXaiTranscript?.(event => {
  if (!liveSttSessionId || event.sessionId !== liveSttSessionId) return;
  if (['error','closed'].includes(event.type)) {
    const captureActive = recordingSession?.coachOnly || mediaRecorder?.state === 'recording';
    liveSttSessionId = null;
    liveProvider = '';
    if (!recordingSession?.stopRequested && !recordingFinishing && captureActive && !speechRecognition) {
      document.querySelector('#record-status').textContent = recordingSession?.coachOnly ? 'Распознавание переподключается…' : 'Онлайн-расшифровка переподключается · запись продолжается';
      startSpeechRecognition();
    }
    return;
  }
  if (event.type !== 'transcript') return;
  const source = event.source === 'system' ? 'system' : 'mic';
  let addedFinal = false;
  if (event.isFinal) {
    const cleanFinal = event.text.trim();
    const completedTurn = ingestLiveSuggestionBoundary(event, source);
    if (event.replaceSource && event.text.trim()) {
      // A provider may send the complete per-channel transcript at the end. Replacing
      // already interleaved turns would destroy the mic/system chronology, so only use
      // this snapshot when no final turns for the source have arrived yet.
      if (!liveUtterances.some(item => item.source === source)) {
        String(event.text).split(/(?<=[.!?])\s+|\n+/).filter(Boolean).forEach(part => { if (appendLiveUtterance(source, part, event.speaker)) addedFinal = true; });
      }
      liveLastFinal[source] = event.text.trim();
      liveLastFinalAt[source] = Date.now();
      liveInterim[source] = '';
    } else if (cleanFinal && (cleanFinal !== liveLastFinal[source] || Date.now() - liveLastFinalAt[source] >= 2500)) {
      liveLastFinal[source] = cleanFinal;
      liveLastFinalAt[source] = Date.now();
      addedFinal = appendLiveUtterance(source, cleanFinal, event.speaker);
    }
    if (event.speechFinal && liveSuggestionsEnabled()) {
      if (completedTurn) scheduleLiveSuggestion(completedTurn, source, event.speaker);
    }
    liveInterim[source] = '';
  } else liveInterim[source] = event.text.trim();
  const partial = [liveInterim.mic ? `[Вы] ${liveInterim.mic}` : '', liveInterim.system ? `[Собеседник] ${liveInterim.system}` : ''].filter(Boolean).join('\n');
  document.querySelector('#record-transcript').textContent = [transcriptText, partial].filter(Boolean).join('\n') || 'Слушаю…';
  if (event.isFinal) updateLiveOutline();
});

function scheduleLiveSuggestion(question, source = '', speaker = '') {
  if (!recordingSession || recordingSession.stopRequested || answerSearchPaused) return;
  const coachOnly = Boolean(recordingSession.coachOnly);
  if (!coachOnly && source === 'mic' && looksLikeSuggestionReadback(recordingSession, question)) {
    const utterance = liveUtterances.at(-1);
    if (utterance && phraseSimilarity(utterance.text, question) >= .9) utterance.kind = 'assistant-readback';
    rebuildTranscriptFromUtterances();
    recordingSession.awaitingInterlocutor = true;
    recordingSession.readbackAt = Date.now();
    document.querySelector('#record-status').textContent = 'Вы озвучиваете подсказку · жду реакцию собеседника';
    return;
  }
  if (coachOnly && source === 'mic' && speaker && recordingSession.userSpeakerId && recordingSession.userSpeakerId !== speaker) return;
  if (!coachOnly && source === 'mic' && speaker && recordingSession.userSpeakerId === speaker) return;
  if (!coachOnly && source === 'mic' && liveHasSystemSource) return;
  let semanticSource = source;
  let continuedAfterReadback = false;
  if (recordingSession.awaitingInterlocutor) {
    const explicitAiRequest = /(?:подскажи|помоги|что ответить|что сказать|как ответить|помощник|эй[,. ]+ai|скажи мне|що відповісти|що сказати|як відповісти|підкажи|help me|what should i say)/i.test(question);
    if (source === 'system' || (source === 'mic' && !explicitAiRequest && !recordingSession.coachScenario?.active)) semanticSource = 'system';
    continuedAfterReadback = semanticSource === 'system';
    recordingSession.awaitingInterlocutor = false;
  }
  if (!coachOnly && source === 'mic' && speaker && recordingSession.userSpeakerId && recordingSession.userSpeakerId !== speaker) semanticSource = 'system';
  const now = Date.now();
  const recentAssistantDialogue = Boolean(coachOnly && recordingSession.coachTurns?.length && now < Number(recordingSession.coachDialogueUntil || 0));
  const pendingTurn = coachOnly && recordingSession.pendingCoachTurn && now - Number(recordingSession.pendingCoachTurn.at || 0) < 12000 ? recordingSession.pendingCoachTurn : null;
  const pendingFollowUp = Boolean(pendingTurn && classifyAssistantTurn(question, { continuationMode:true, directAssistantMode:true }).action === 'respond');
  const continuingDialogue = Boolean(recordingSession.coachScenario?.active || continuedAfterReadback || recentAssistantDialogue || pendingFollowUp);
  const expectedReply = Boolean(coachOnly && recentAssistantDialogue && assistantExpectsReply(recordingSession));
  const startsDialogue = Boolean(coachOnly && looksLikeCoachRequest(question));
  const interlocutorMode = Boolean(!coachOnly && semanticSource === 'system');
  const turnGate = Boolean((coachOnly && source === 'mic') || interlocutorMode);
  const initialDecision = turnGate
    ? classifyAssistantTurn(question, { continuationMode:continuingDialogue, roleplay:Boolean(recordingSession.coachScenario?.active), interlocutorMode, directAssistantMode:coachOnly, expectedReply })
    : null;
  const directAssistantTurn = initialDecision?.action === 'respond';
  if (!turnGate && !continuingDialogue && !startsDialogue && !directAssistantTurn && !looksLikeAddressedQuestion(question, { allowFirstQuestion:coachOnly })) return;
  if (normalizedPhrase(question) === normalizedPhrase(lastSuggestedQuestion) && Date.now() - lastSuggestedAt < 2500) return;
  const queuedQuestion = pendingFollowUp && normalizedPhrase(pendingTurn.text) !== normalizedPhrase(question)
    ? `${String(pendingTurn.text || '').trim()}\nУточнение: ${String(question || '').trim()}`.slice(-2000)
    : question;
  const next = {
    question:queuedQuestion, source:semanticSource, speaker, continuationMode:continuingDialogue,
    turnGate, interlocutorMode, directAssistantMode:coachOnly, expectedReply, roleplay:Boolean(recordingSession.coachScenario?.active),
    queuedAt:now, startedAt:now, mergeWindowMs:turnGate ? (liveProvider === 'groq' ? 8500 : 6500) : 3500
  };
  suggestionCandidate = mergeSuggestionRequests(suggestionCandidate, next);
  const combinedDecision = suggestionCandidate.turnGate
    ? classifyAssistantTurn(suggestionCandidate.question, { continuationMode:suggestionCandidate.continuationMode, roleplay:suggestionCandidate.roleplay, interlocutorMode:suggestionCandidate.interlocutorMode, directAssistantMode:suggestionCandidate.directAssistantMode, expectedReply:suggestionCandidate.expectedReply })
    : null;
  if (combinedDecision?.action === 'wait' && !recordingSession.lastAssistantSuggestion) {
    document.getElementById('live-suggestion').textContent = 'Слушаю до конца мысли…';
  } else if (coachOnly && !recordingSession.lastAssistantSuggestion) {
    document.getElementById('live-suggestion').textContent = 'Реплика распознана · определяю, нужен ли ответ…';
  }
  armSuggestionCandidate(combinedDecision?.delayMs || (coachOnly ? 1800 : 1300));
}

function mergeSuggestionRequests(current, next) {
  if (!current?.question) return next;
  const mergeWindowMs = Math.max(3500, Number(current.mergeWindowMs || 0), Number(next.mergeWindowMs || 0));
  if (current.source !== next.source || Number(next.queuedAt || 0) - Number(current.queuedAt || 0) > mergeWindowMs) return next;
  const previousText = String(current.question || '').trim();
  const nextText = String(next.question || '').trim();
  const previousNormalized = normalizedPhrase(previousText);
  const nextNormalized = normalizedPhrase(nextText);
  let question;
  if (!previousNormalized) question = nextText;
  else if (!nextNormalized) question = previousText;
  else if (nextNormalized.includes(previousNormalized)) question = nextText;
  else if (previousNormalized.includes(nextNormalized)) question = previousText;
  else question = `${previousText} ${nextText}`.trim();
  return {
    ...next, question:question.slice(-2000), mergeWindowMs,
    startedAt:Number(current.startedAt || current.queuedAt || next.startedAt || next.queuedAt || Date.now()),
    continuationMode:Boolean(current.continuationMode || next.continuationMode),
    turnGate:Boolean(current.turnGate || next.turnGate),
    interlocutorMode:Boolean(current.interlocutorMode || next.interlocutorMode),
    directAssistantMode:Boolean(current.directAssistantMode || next.directAssistantMode),
    expectedReply:Boolean(current.expectedReply || next.expectedReply),
    roleplay:Boolean(current.roleplay || next.roleplay)
  };
}

function armSuggestionCandidate(delayMs = 1300) {
  clearTimeout(suggestionTimer);
  const generation = suggestionGate.generation();
  const revision = ++suggestionCandidateRevision;
  suggestionTimer = setTimeout(() => {
    if (generation !== suggestionGate.generation() || revision !== suggestionCandidateRevision) return;
    flushSuggestionCandidate();
  }, Math.max(350, Math.min(6500, Number(delayMs) || 1300)));
}

function flushSuggestionCandidate() {
  const candidate = suggestionCandidate;
  if (!candidate) return;
  if (candidate.turnGate) {
    let decision = classifyAssistantTurn(candidate.question, { continuationMode:candidate.continuationMode, roleplay:candidate.roleplay, interlocutorMode:candidate.interlocutorMode, directAssistantMode:candidate.directAssistantMode, expectedReply:candidate.expectedReply });
    if (decision.action !== 'respond') {
      const idleMs = Date.now() - Number(candidate.queuedAt || 0);
      const holdMs = Math.max(3500, Number(candidate.mergeWindowMs || 6500));
      if (idleMs < holdMs) {
        armSuggestionCandidate(Math.min(decision.delayMs || 1600, holdMs - idleMs));
        return;
      }
      decision = classifyAssistantTurn(candidate.question, { continuationMode:candidate.continuationMode, roleplay:candidate.roleplay, interlocutorMode:candidate.interlocutorMode, directAssistantMode:candidate.directAssistantMode, expectedReply:candidate.expectedReply, forceComplete:true });
      if (decision.action !== 'respond') {
        suggestionCandidate = null;
        if (recordingSession?.coachOnly && !recordingSession.lastAssistantSuggestion) {
          document.getElementById('live-suggestion').textContent = 'Жду законченный вопрос, просьбу или описание задачи…';
        }
        return;
      }
    }
  }
  suggestionCandidate = null;
  void requestLiveSuggestion(candidate.question, candidate.source, candidate.speaker, candidate.continuationMode);
}

function inferAssistantIntent(value) {
  const text = String(value || '').toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ').trim();
  if (/(?:что|що)\s+(?:ответить|відповісти|сказать|сказати)|как\s+(?:ответить|сказать)|як\s+(?:відповісти|сказати)|(?:дай|предложи|підкажи|запропонуй)\s+(?:реплик|фраз|ответ|відповід)/i.test(text)) return 'draft_response';
  if (/(?:зачем|для чего|чому|навіщо|для чого|поясни|объясни|що означає|что означает|смысл|сенс)/i.test(text)) return 'explain';
  if (/(?:сколько|скільки|какие|які|назови|назвіть|перечисли|перелічи|этап|етап|шаг|крок|алгоритм|структур)/i.test(text)) return 'enumerate';
  if (/(?:сравни|порівняй|разница|різниця|лучше|краще|відмін|отлич)/i.test(text)) return 'compare';
  if (/(?:проанализ|проаналіз|оцени|оціни|розбери|разбери|почему не|чому не)/i.test(text)) return 'analyze';
  if (/(?:план|что делать|що робити|наступн.*крок|следующ.*шаг)/i.test(text)) return 'plan';
  return 'answer';
}

function classifyAssistantTurn(value, { continuationMode = false, roleplay = false, interlocutorMode = false, directAssistantMode = false, expectedReply = false, forceComplete = false } = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 1200) return { action:'ignore', delayMs:2400, reason:'length' };
  const normalized = text.toLocaleLowerCase('uk-UA');
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’ʼ-]*/gu) || [];
  const fillerOnly = /^(?:э+м*|м+|ну|ага|угу|да|нет|окей|хорошо|понятно|ладно|короче|в общем|типа|привет|здравствуйте|дякую|спасибо|hello|hi|okay|yes|no)[.!?…]*$/i.test(normalized);
  const acknowledgementOnly = /^(?:да|нет|ага|угу|окей|хорошо|понятно|ясно|ладно|спасибо|дякую|так|ні|добре|зрозуміло|okay|yes|no|thanks)(?:[,\s]+(?:понял(?:а)?|понятно|ясно|спасибо|дякую|зрозуміло|got it|thanks))*[.!…]*$/i.test(normalized);
  const hasQuestionMark = /[?？]\s*$/.test(text);
  const thirdPartyNarration = /^(?:он|она|они|клиент(?:ка)?|собеседник|він|вона|вони|клієнт(?:ка)?|співрозмовник|he|she|they|the client)(?:\s|[,.:;!?])[^.!?]{0,120}(?:не уверен|сомневается|выбирает|думает|не впевнен|сумнівається|обирає|думає|is unsure|is thinking|is choosing)(?:\s|$|[,.:;!?])/i.test(normalized);
  const narrativeLead = /^(?:вчера|раньше|на прошлой|учора|раніше|минулого)(?:\s|$|[,.:;!?])|^(?:сегодня|сьогодні)\s+(?:(?:мы|ми)\s+)?(?:обсуждали|говорили|рассматривали|обговорювали|розглядали)(?:\s|$|[,.:;!?])|^(?:сейчас\s+расскажу|зараз\s+розповім|today\s+we\s+discussed|yesterday\s+i)(?:\s|$|[,.:;!?])/i.test(normalized);
  const questionAtStart = /^(?:(?:ну|так|слушай|смотри|скажите?|подскажи(?:те)?|а|и|well|so|listen)\s+){0,3}(?:как(?:ой|ая|ое|ие)?|что|чем|в\s+ч[её]м|куда|откуда|когда|почему|зачем|кто|где|сколько|можно\s+ли|нужно\s+ли|надо\s+ли|стоит\s+ли|есть\s+ли|есть\s+смысл|готовы\s+ли|можешь|можете|чи|як(?:ий|а|е|і)?|що|чим|у\s+чому|куди|звідки|коли|чому|навіщо|хто|де|скільки|can|could|would|will|are|is|do|does|did|has|have|should|what|which|how|when|why|who|where)(?:\s|$|[,.?!:;])/i.test(normalized);
  const questionInsideOwnThought = /(?:я\s+(?:хочу понять|не понимаю|не знаю)|мне\s+интересно|мій\s+вопрос|мо[єй]\s+питання|у\s+меня\s+вопрос)[^.!?]{0,120}(?:как|что|почему|зачем|когда|як|що|чому|навіщо|коли|how|what|why|when)(?:\s|$|[,.?!:;])/i.test(normalized)
    || /я\s+думаю\s*,?\s*(?:как|почему|зачем|когда|где|як|чому|навіщо|коли|де|how|why|when|where)(?:\s|$|[,.?!:;])/i.test(normalized);
  const midSentenceQuestion = !thirdPartyNarration && !narrativeLead && /(?:^|[,;]\s*|\b(?:а|и|но|але|і)\s+)(?:как(?:ой|ая|ое|ие)?|чем|куда|откуда|почему|зачем|когда|як(?:ий|а|е|і)?|чим|куди|звідки|чому|навіщо|коли|how|which|why|when|where)(?:\s|$|[,.?!:;])/i.test(normalized);
  const modalQuestion = /^(?:можно|получится|поможет|работает|стоит|нужно|надо|нормально|правильно|имеет\s+смысл|есть\s+смысл)\s+ли(?:\s|$|[,.?!:;])/i.test(normalized)
    || /^(?:можно|получится|поможет|стоит|нужно|надо|можем|можете|вийде|допоможе|варто|потрібно|треба|можемо|можете)\s+(?:не\s+)?[\p{L}'’ʼ-]+(?:ть|ти|чь)(?:\s|$|[,.?!:;])/iu.test(normalized)
    || /^(?:does|did|is|are|can|could|should|will|would|has|have)(?:\s|$|[,.?!:;])/i.test(normalized);
  const directAddressQuestion = /(?:^|[\s,.!?;])(?:ты|вы|ти|ви|you)\s+(?:знаешь|знаете|думаешь|думаете|считаешь|считаете|проверял(?:а|и)?|проверяли|тестировал(?:а|и)?|тестировали|видишь|видите|понимаешь|понимаете|можешь|можете|знаєш|знаєте|думаєш|думаєте|вважаєш|вважаєте|перевіряв(?:ла|ли)?|перевіряли|тестував(?:ла|ли)?|тестували|бачиш|бачите|розумієш|розумієте|можеш|можете|know|think|checked|tested|see|understand|can)(?:\s|$|[,.?!:;])/i.test(normalized);
  const singleWhQuestion = /^(?:что|как|почему|зачем|где|кто|куда|що|як|чому|навіщо|де|хто|куди|what|how|why|where|who)[.!?…]*$/i.test(normalized);
  const explicitRequest = /(?:^|[\s,.:;!?])(?:подскажи(?:те)?|помоги(?:те)?|объясни(?:те)?|расскажи(?:те)?|раскрой(?:те)?|скажи(?:те)?|ответь(?:те)?|дай(?:те)?|давай(?:те)?|делай(?:те)?|продолжай(?:те)?|составь(?:те)?|сделай(?:те)?|найди(?:те)?|покажи(?:те)?|оцени(?:те)?|проанализируй(?:те)?|проверь(?:те)?|посоветуй(?:те)?|підкажи(?:іть)?|допоможи(?:іть)?|поясни(?:іть)?|розкажи(?:іть)?|розкрий(?:те)?|скажи(?:іть)?|відповідай(?:те)?|дай(?:те)?|давай(?:те)?|роби(?:іть)?|продовжуй(?:те)?|склади(?:іть)?|зроби(?:іть)?|знайди(?:іть)?|покажи(?:іть)?|оціни(?:іть)?|проаналізуй(?:те)?|перевір(?:те)?|порадь(?:те)?|help me|tell me|explain|show me|give me|go ahead|do it|continue|find|check|analy[sz]e|suggest)(?:\s|$|[,.?!:;])/i.test(normalized);
  const taskStatement = /(?:мне|нам)\s+(?:нужно|надо|необходимо)\s+(?:подготовить|составить|сделать|разобрать|понять|выбрать|решить|ответить|спланировать)|я\s+хочу\s+(?:понять|узнать|подготовить|составить|сделать|разобраться|решить)|у\s+меня\s+(?:вопрос|проблема|задача)|у\s+меня\s+не\s+получается|я\s+не\s+знаю\s+(?:как|что)\s+(?:мне|нам|лучше|правильно|можно|стоит)|(?:мені|нам)\s+(?:треба|потрібно|необхідно)\s+(?:підготувати|скласти|зробити|розібрати|зрозуміти|вибрати|вирішити|відповісти|спланувати)|я\s+хочу\s+(?:зрозуміти|дізнатися|підготувати|скласти|зробити|розібратися|вирішити)|у\s+мене\s+(?:питання|проблема|задача)|i\s+(?:need|want)\s+to\s+(?:prepare|make|understand|choose|solve|answer|plan)|i\s+(?:have|got)\s+(?:a\s+)?(?:question|problem|task)/i.test(normalized);
  const problemStatement = /(?:не\s+(?:работает|запускается|отвечает|реагирует|появляется|получается)|бездействует|зависает|сломал(?:ось|ся|ась)|выда[её]т\s+ошибку|не\s+(?:працює|запускається|відповідає|реагує|з'являється|виходить)|нічого\s+не\s+відбувається|не\s+вдається|does(?:n't| not)\s+(?:work|start|respond|appear)|not\s+working|keeps\s+freezing|nothing\s+happens)/i.test(normalized);
  const quotedSpeech = /(?:он|она|они|клиент|клиентка|человек|собеседник|він|вона|вони|клієнт|людина|співрозмовник|he|she|they|the client)\s+(?:сказал|сказала|спросил|спросила|говорит|сказав|сказала|запитав|запитала|говорить|said|asked)/i.test(normalized);
  const selfUncertainty = /(?:^|[,;]\s*(?:но|але)?\s*)(?:(?:я|мені|мне)\s+)?(?:не знаю|не уверен(?:а)?|сомневаюсь|не могу (?:решить|выбрать|определиться)|мне (?:сложно|трудно)|не впевнен(?:а)?|сумніваюся|не можу (?:вирішити|обрати|визначитися)|мені (?:складно|важко))/i.test(normalized);
  const decisionTarget = /(?:что|що)\s+(?:лучше|краще|выбрать|обрати|делать|робити)|(?:какой|какая|який|яка)|между|між|выб(?:ра|о)|обрати|определ|визнач|решит|виріш|стоит\s+ли|чи\s+варто|правиль|над[её]ж|надійн/i.test(normalized);
  const targetedUncertainty = selfUncertainty && decisionTarget;
  const activeDeliberation = /(?:думаю|размышляю|колеблюсь|склоняюсь|выбираю|думаю|вагаюся|схиляюся|обираю)[^.!?]{0,140}(?:между|між|насч[её]т|щодо|над\s+тем|что\s+выбрать|що\s+обрати|может|мабуть|лучше|краще)/i.test(normalized);
  const concernNeed = /^(?:(?:я\s+)?(?:боюсь|опасаюсь|переживаю|боюся|хвилююся)|меня\s+(?:смущает|беспокоит|останавливает)|мене\s+(?:бентежить|турбує|зупиняє)|(?:есть|є)\s+(?:сомнения|сумніви))/i.test(normalized) || /(?:но|але)\s+(?:я\s+)?(?:не уверен|сомневаюсь|не впевнений|сумніваюся)|(?:но|але)\s+(?:есть сомнения|є сумніви)/i.test(normalized);
  const softGoal = /(?:хотелось\s+бы|хочу|мне\s+хочется|хотілося\s+б|хочу|мені\s+хочеться)[^.!?]{0,160}(?:понять|разобраться|решить|выбрать|сравнить|зрозуміти|розібратися|вирішити|обрати|порівняти)/i.test(normalized);
  const desireTask = /(?:я\s+(?:ещ[её]\s+)?(?:хочу|хотел(?:а)?\s+бы)|мне\s+(?:бы\s+хотелось|хочется|хотелось\s+бы)|хорошо\s+бы|было\s+бы\s+(?:удобно|полезно)|я\s+(?:ще\s+)?хочу|мені\s+(?:б\s+хотілося|хочеться|хотілося\s+б)|добре\s+було\s+б|було\s+б\s+зручно|i(?:'d| would)\s+like|i\s+(?:want|need))[^.!?]{0,220}(?:чтобы|щоб|добав|дод|сдел|зроб|перен|провер|перевір|сравн|порівн|исправ|виправ|настро|налашт|понимал|розумів|move|add|make|check|compare|fix)/i.test(normalized);
  const tradeoffNeed = /(?:лучше|хуже|быстр|точн|дешев|дороже|над[её]ж|удобн|важн|риск|краще|гірше|швидш|точн|дешевш|дорожч|надійн|зручн|важлив|ризик)[^.!?]{0,100}(?:но|зато|при этом|с другой стороны|але|зате|водночас|з іншого боку)[^.!?]{0,100}(?:лучше|хуже|быстр|точн|дешев|дороже|над[её]ж|удобн|важн|риск|краще|гірше|швидш|точн|дешевш|дорожч|надійн|зручн|важлив|ризик)/i.test(normalized);
  const implicitModal = /^(?:(?:а|и|ну|так|слушай|смотри)\s+)+(?:(?:это|оно|мы|нам|мне|це|воно|ми|нам|мені)\s+)?(?:вообще\s+|взагалі\s+)?(?:можем|можно|стоит|нужно|надо|получится|поможет|работает|имеет\s+смысл|можемо|можна|варто|потрібно|вийде|допоможе|працює)(?:\s|$|[,.?!:;])/i.test(normalized)
    || /^(?:это|оно|мы|нам|мне|це|воно|ми|нам|мені)\s+(?:вообще\s+|взагалі\s+)?(?:можем|можно|стоит|нужно|надо|получится|поможет|работает|имеет\s+смысл|можемо|можна|варто|потрібно|вийде|допоможе|працює)(?:\s|$|[,.?!:;])/i.test(normalized);
  const correctionSignal = continuationMode && /^(?:(?:ну|так|а)\s+)?(?:нет,?\s+я\s+(?:имел|имела)\s+в\s+виду|не\s+то|это\s+не\s+то|ты\s+меня\s+не\s+понял(?:а)?|я\s+же\s+(?:говорил|говорила|сказал|сказала)|тебе\s+же\s+говорилось|ні,?\s+я\s+мав(?:ла)?\s+на\s+увазі|це\s+не\s+те|ти\s+мене\s+не\s+зрозумів(?:ла)?|no,?\s+i\s+meant|that's\s+not\s+what\s+i\s+meant)/i.test(normalized);
  const reflectiveFollowUp = continuationMode && /^(?:не уверен(?:а)?|не знаю|сомневаюсь|мне это не подходит|сложно сказать|не впевнен(?:а)?|сумніваюся|мені це не підходить|важко сказати)[.!?…]*$/i.test(normalized);
  const conversationalFollowUp = continuationMode && /^(?:(?:а|и|ну|так|тогда|тоді|and|so)\s+)?(?:подробнее|детальнее|раскрой|по\s+шагам|на\s+примере|с\s+примерами|покороче|коротко|в\s+двух\s+словах|другой\s+вариант|альтернатива|есть\s+ещ[её]\s+вариант|допустим|получается|то\s+есть|это\s+точно|правда|верно|продолжай|с\s+первым\s+вариантом|первый|второй|этот\s+вариант|детальніше|розкрий|по\s+кроках|на\s+прикладі|коротше|інший\s+варіант|виходить|тобто|це\s+точно|продовжуй|перший|другий|more\s+detail|step\s+by\s+step|another\s+option|so\s+that\s+means|continue)(?:\s|$|[,.?!:;])/i.test(normalized);
  const shortAnswerToAssistant = continuationMode && expectedReply && /^(?:да|нет|так|ні|yes|no|первый|второй|оба|этот|тот|перший|другий|обидва|цей|той)(?:\s|$|[,.?!:;])/i.test(normalized);
  const expectedReplyTurn = continuationMode && expectedReply && words.length >= 1 && words.length <= 40 && !acknowledgementOnly;
  const indirectNeed = directAssistantMode && !thirdPartyNarration && !narrativeLead && (targetedUncertainty || activeDeliberation || concernNeed || softGoal || desireTask || tradeoffNeed || implicitModal);
  const openEnding = /(?:[,;:]|[-–—]|\.{2,}|…)\s*$/.test(text)
    || /(?:\b(?:и|а|но|или|что|чтобы|если|когда|потому(?:\s+что)?|так\s+как|как|например|то\s+есть|который|которая|которые|і|але|або|що|щоб|якщо|коли|тому\s+що|оскільки|як|наприклад|тобто|який|яка|які|and|but|or|that|because|if|when|so|like|which|who|for|with|to))\s*$/i.test(normalized)
    || /(?:я\s+хотел(?:а)?\s+спросить|я\s+хочу\s+спросить|мне\s+(?:нужно|надо)|я\s+хочу|подскажи(?:те)?(?:\s+мне)?|помоги(?:те)?(?:\s+мне)?|скажи(?:те)?(?:\s+мне)?|розкажи(?:іть)?(?:\s+мені)?|підкажи(?:іть)?(?:\s+мені)?|допоможи(?:іть)?(?:\s+мені)?|i\s+(?:want|need)\s+to\s+(?:ask|know)|help\s+me|tell\s+me)\s*[.!…]*$/i.test(normalized);
  const objectionTurn = /(?:^|[\s,.:;!?])(?:дорого|слишком дорого|неинтересно|не интересно|не актуально|нет времени|подумаю|я подумаю|не уверен|не уверена|не готов|не готова|не хочу|уже занимаюсь|уже учусь|сейчас не могу|нет денег|позже|меня всё устраивает|не впевнений|не впевнена|не готовий|не готова|не хочу|вже займаюся|вже навчаюся|зараз не можу|немає часу|немає грошей|пізніше|мене все влаштовує|нецікаво|не актуально|expensive|too expensive|not interested|no time|maybe later|i will think|i'm not sure|i am not sure|not ready|can't now|cannot now)(?:\s|$|[,.?!:;])/i.test(normalized);
  const shortDialogueTurn = Boolean((roleplay || interlocutorMode) && objectionTurn);
  const followUpSignal = /^(?:(?:а|и|але|і|and|but)\s+)?(?:теперь|дальше|ещ[её]|потом|если|почему|как|что|уточни|продолжи|объясни|покажи|приведи|сравни|а\s+если|що\s+далі|тепер|далі|ще|потім|якщо|чому|як|що|уточни|продовж|поясни|покажи|наведи|порівняй|now|next|also|then|if|why|how|what|clarify|continue|explain|show|compare)(?:\s|$|[,.?!:;])/i.test(normalized);

  if ((fillerOnly || acknowledgementOnly) && !shortAnswerToAssistant) return { action:'ignore', delayMs:2200, reason:'acknowledgement' };
  if ((thirdPartyNarration || narrativeLead) && !hasQuestionMark && !explicitRequest) return { action:'ignore', delayMs:2200, reason:'narration' };
  if (!shortDialogueTurn && !singleWhQuestion && !shortAnswerToAssistant && !expectedReplyTurn && words.length < 2 && !hasQuestionMark && !explicitRequest) return { action:'ignore', delayMs:2200, reason:'fragment' };
  if (openEnding && !hasQuestionMark && !singleWhQuestion && !forceComplete) return { action:'wait', delayMs:3000, reason:'open_ending' };

  let intentScore = 0;
  if (hasQuestionMark) intentScore += 4;
  if (questionAtStart) intentScore += 3;
  if (questionInsideOwnThought || midSentenceQuestion) intentScore += 2;
  if (modalQuestion || directAddressQuestion) intentScore += 3;
  if (singleWhQuestion) intentScore += 3;
  if (explicitRequest) intentScore += 3;
  if (taskStatement) intentScore += 2;
  if (problemStatement) intentScore += 2;
  if (indirectNeed) intentScore += 2;
  if (correctionSignal || reflectiveFollowUp || conversationalFollowUp) intentScore += 2;
  if (shortAnswerToAssistant || expectedReplyTurn) intentScore += 2;
  if (quotedSpeech && !hasQuestionMark) intentScore -= 2;
  if (shortDialogueTurn) intentScore += 3;

  const dialogueContinuation = roleplay && (words.length >= 2 || shortDialogueTurn)
    || continuationMode && interlocutorMode && (words.length >= 2 || shortDialogueTurn)
    || continuationMode && (followUpSignal || correctionSignal || reflectiveFollowUp || conversationalFollowUp || expectedReplyTurn);
  if (intentScore >= 2 || dialogueContinuation) {
    const contextual = indirectNeed || correctionSignal || reflectiveFollowUp || conversationalFollowUp || expectedReplyTurn;
    const delayMs = singleWhQuestion ? 2400 : hasQuestionMark ? 850 : contextual ? 2200 : /[.!]\s*$/.test(text) ? 1100 : 1650;
    return { action:'respond', delayMs, reason:indirectNeed ? 'indirect_need' : contextual ? 'contextual' : intentScore >= 2 ? 'intent' : 'dialogue' };
  }
  return { action:'ignore', delayMs:2600, reason:'ordinary_statement' };
}

function looksLikeMeaningfulAssistantTurn(value) {
  return classifyAssistantTurn(value).action === 'respond';
}

function looksLikeCoachRequest(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < 5 || text.length > 600) return false;
  return /(?:^|[\s,.:;!?])(?:давай(?:те)?|помоги(?:те)?|потренируй|проведи|начн[её]м|сыграем|отработаем|отыграем|твой черед|твоя очередь|ты клиент|ты покупатель|будь клиентом|відпрацю(?:ймо|ємо)|давай|допоможи|потренуй|проведи|почн(?:імо|емо)|зіграємо|твоя черга|ти клієнт|simulate|practice|your turn|help me|let'?s)(?:\s|$|[,.?!:;])/i.test(text);
}

function updateCoachScenario(session, value) {
  if (!session?.coachOnly) return null;
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const normalized = text.toLocaleLowerCase('uk-UA');
  if (/(?:закончим|заверши|стоп|выйди из роли|не играем|досить|завершимо|stop roleplay)/i.test(normalized)) {
    if (session.coachScenario) session.coachScenario.active = false;
    return session.coachScenario || null;
  }
  const knowledgeQuestion = /(?:сколько|скільки|какие|які|назови|назвіть|перечисли|перелічи|объясни|поясни|что такое|що таке|этап|етап|алгоритм|структур|правил|схем)[^.!?]{0,100}(?:возраж|запереч|продаж|скрипт|діалог|диалог)|(?:возраж|запереч|продаж|скрипт)[^.!?]{0,100}(?:сколько|скільки|какие|які|этап|етап|алгоритм|структур|правил|схем)/i.test(normalized);
  if (session.coachScenario?.active && knowledgeQuestion) {
    session.coachScenario.active = false;
    session.coachScenario.justStarted = false;
    session.coachScenario.endedBy = 'knowledge-question';
    return session.coachScenario;
  }
  const startsRoleplay = /(?:отыгра(?:ем|й|йте)?|разыгра(?:ем|й|йте)?|сыграем\s+(?:диалог|сцену)|ролевая\s+(?:игра|сцена)|роль\s+(?:клиента|покупателя|менеджера)|ты\s+(?:клиент|покупатель|менеджер)|будь\s+(?:клиентом|покупателем|менеджером)|зігра(?:ймо|ємо)\s+(?:діалог|сцену)|роль\s+(?:клієнта|покупця|менеджера)|ти\s+(?:клієнт|покупець|менеджер)|будь\s+(?:клієнтом|покупцем|менеджером)|role\s*play|roleplay|you are (?:the )?(?:client|customer|manager))/i.test(normalized);
  if (startsRoleplay) {
    const userIsClient = /(?:^|\b)(?:я|моя роль|я буду|я играю|я зіграю|моя роль|i(?:'ll| will)? play)(?:[^.!?]{0,35})(?:клиент|покупател|клієнт|customer|buyer)/i.test(normalized);
    const assistantIsClient = !userIsClient && /(?:клиент|покупател|клієнт|customer|buyer)/i.test(normalized);
    const persona = /(?:не заинтерес|не зацікав|not interested)/i.test(normalized) ? 'не заинтересован и сначала не видит причины продолжать разговор'
      : /(?:дорого|дорог|expensive)/i.test(normalized) ? 'считает предложение слишком дорогим'
      : /(?:нет времени|немає часу|busy)/i.test(normalized) ? 'считает, что у него нет времени'
      : /(?:уже занима|вже займа|already stud)/i.test(normalized) ? 'уже занимается в другом месте'
      : 'реалистичный собеседник, который задаёт уточняющие вопросы и не соглашается без причины';
    session.coachScenario = {
      active:true, justStarted:true,
      assistantRole:assistantIsClient ? 'client' : 'manager',
      userRole:assistantIsClient ? 'manager' : 'client',
      persona, goal:text.slice(0,500), turn:1, startedAt:Date.now()
    };
  } else if (session.coachScenario?.active) {
    session.coachScenario.justStarted = false;
    session.coachScenario.turn = Number(session.coachScenario.turn || 0) + 1;
  }
  return session.coachScenario || null;
}

function localRoleplayReply(session, question) {
  const scenario = session?.coachScenario;
  if (!scenario?.active) return '';
  const text = String(question || '').toLocaleLowerCase('uk-UA');
  if (scenario.assistantRole === 'client') {
    if (/(?:пробн|trial|бесплат|безкоштов)/i.test(text)) return 'А что именно будет на пробном занятии и сколько времени оно займёт?';
    if (/(?:цен|цін|стоим|варт|грн|price)/i.test(text)) return 'Понятно. А сколько это будет стоить и есть ли смысл платить, если я пока не уверен, что буду заниматься регулярно?';
    if (/(?:здравствуйте|добрый|вітаю|добрий|позвонил|телефоную|школ|англий|англій|обучен|навчан)/i.test(text)) {
      if (/не заинтерес|не зацікав/i.test(scenario.persona)) return 'Здравствуйте. Если честно, мне сейчас это не очень интересно — я пока не планировал заниматься. А по какому вопросу вы звоните?';
      if (/нет времени/i.test(scenario.persona)) return 'Здравствуйте. Я вас слушаю, но сразу скажу: у меня сейчас совсем нет времени на регулярные занятия.';
      if (/уже занимается/i.test(scenario.persona)) return 'Здравствуйте. Я уже занимаюсь в другом месте, поэтому пока не уверен, что мне нужно что-то менять.';
    }
    return Number(scenario.turn || 1) <= 1 ? 'Хорошо, я играю клиента. Начинайте разговор — я буду отвечать как реальный покупатель.' : 'Пока не уверен, что мне это нужно. Объясните, пожалуйста, чем ваше предложение будет полезно именно мне?';
  }
  const ranked = rankWorkspaceKnowledgeEntries(session.spaceId, question);
  const source = ranked.find(entry => entry.score > 0 && entry.source === 'playbook') || ranked.find(entry => entry.score > 0);
  const fact = String(source?.text || '').split(/\n+|(?<=[.!?])\s+/).map(part => part.replace(/^[•\-–—\d.)\s]+/, '').trim()).filter(Boolean).slice(0,2).join(' ');
  if (/(?:дорого|дорог|expensive)/i.test(text)) return `Понимаю, цена важна. ${fact || 'Давайте сначала уточним, какой результат и формат вам нужен, чтобы сравнивать не только сумму, но и пользу.'}`.trim();
  if (/(?:не интересно|неинтерес|не актуаль|не зацікав)/i.test(text)) return 'Понимаю. Подскажите, вы уже где-то занимаетесь или сейчас в принципе не рассматриваете обучение?';
  return fact || 'Понял вас. Подскажите, что именно для вас сейчас важнее всего — результат, удобный график или стоимость?';
}

function looksLikeAddressedQuestion(value, { allowFirstQuestion = false } = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < (allowFirstQuestion ? 5 : 12) || text.length > 500) return false;
  if (!allowFirstQuestion && liveUtterances.length < 2 && transcriptText.length < 80) return false;
  const normalized = text.toLocaleLowerCase('uk-UA');
  const selfAnswer = /^(?:мой ответ|моя відповідь|мій ответ|я готов(?:а)?|я буду|i(?:'m| am)? ready|i will|she will do it)\b/i.test(normalized);
  if (selfAnswer && !text.includes('?')) return false;
  if (text.includes('?')) return true;
  return /(?:^|[\s,.:;!?])(?:как(?:ой|ая|ое|ие)?|что|когда|почему|кто|где|сколько|какие|назови(?:те)?|перечисли(?:те)?|подскажи(?:те)?|готовы ли|можете|скажите|расскажите|ответьте|чи ви|як(?:ий|а|е|і)?|які|що|коли|чому|хто|де|скільки|назви(?:іть)?|перелічи(?:іть)?|підкажи(?:іть)?|можете|скажіть|розкажіть|відповісте|can you|could you|would you|will you|are you|do you|what|which|how|when|why|who|where|list|tell me)(?:\s|$|[,.?!:;])/i.test(normalized);
}

function assistantExpectsReply(session) {
  if (!session?.lastAssistantSuggestion || Date.now() - Number(session.lastAssistantSuggestionAt || 0) > 90000) return false;
  const tail = String(session.lastAssistantSuggestion || '').trim().slice(-600);
  return /[?？](?:\s|$)/.test(tail)
    || /(?:подскажи(?:те)?|скажи(?:те)?|уточни(?:те)?|выбери(?:те)?|назови(?:те)?|підкажи(?:іть)?|скажи(?:іть)?|уточни(?:іть)?|обери(?:іть)?|назви(?:іть)?|tell me|choose|clarify)[^.!?]{0,140}[.!…]*$/i.test(tail);
}

function rememberCoachTurn(session, userText, assistantText, source = 'mic') {
  if (!session || !assistantText) return;
  session.coachTurns ||= [];
  const previous = session.coachTurns.at(-1);
  if (previous?.user === userText) previous.assistant = assistantText;
  else session.coachTurns.push({ user:userText, assistant:assistantText, source, at:Date.now() });
  session.coachTurns = session.coachTurns.slice(-18);
  session.coachDialogueUntil = Date.now() + 45 * 1000;
  session.lastAssistantSuggestion = assistantText;
  session.lastAssistantSuggestionAt = Date.now();
  session.awaitingInterlocutor = false;
}

function looksLikeSuggestionReadback(session, value) {
  if (!session || !session.lastAssistantSuggestion || Date.now() - Number(session.lastAssistantSuggestionAt || 0) > 90 * 1000) return false;
  const spoken = normalizedPhrase(value);
  if (spoken.length < 12) return false;
  const suggestion = String(session.lastAssistantSuggestion || '').replace(/^(?:нейтрально|впевнено|уверенно|опорні факти|опорные факты|наступне питання|следующий вопрос)\s*:?/gim, ' ');
  if (phraseSimilarity(suggestion, spoken) >= .72) return true;
  return suggestion.split(/\n+|(?<=[.!?])\s+/).some(fragment => normalizedPhrase(fragment).length >= 12 && phraseSimilarity(fragment, spoken) >= .78);
}

async function requestLiveSuggestion(question, source = '', speaker = '', continuationMode = false) {
  if (!window.sloy?.xaiSuggest) return;
  if (!recordingSession || recordingSession.stopRequested || answerSearchPaused) return;
  const session = recordingSession;
  const activeRequest = suggestionGate.active();
  if (activeRequest?.session === session && normalizedPhrase(activeRequest.input) === normalizedPhrase(question)) return;
  const ticket = suggestionGate.begin(session, question);
  session.pendingCoachTurn = { text:question, at:Date.now(), requestId:ticket.id };
  const requestPauseRevision = answerPauseRevision;
  if (session.coachOnly) updateCoachScenario(session, question);
  suggestionInFlight = true;
  const coach = document.getElementById('live-coach');
  const output = document.getElementById('live-suggestion');
  coach.hidden = false;
  const localAnswer = findLocalWorkspaceAnswer(session.spaceId, question);
  const roleplayFallback = localRoleplayReply(session, question);
  const heldAnswer = String(session.lastAssistantSuggestion || '').trim();
  if (!heldAnswer) output.textContent = session.coachScenario?.active ? 'Понимаю роли и готовлю следующую реплику…' : 'Собираю точный ответ из базы знаний…';
  window.sloy?.hideAnswerPopup?.();
  document.querySelector('#record-status').textContent = 'Запрос принят · готовлю ответ…';
  try {
    const roleHint = source === 'system'
      ? 'Последняя реплика определена как вопрос или реакция собеседника. Подготовь пользователю готовую естественную реплику для продолжения той же цепочки.'
      : recordingSession?.coachOnly
        ? 'Последняя реплика пришла с микрофона пользователя: это прямой вопрос пользователя к AI-помощнику. Ответь на него сразу, даже если это первая реплика.'
      : recordingSession?.userSpeakerId
      ? `Голос пользователя уже отмечен как «Вы». Последняя реплика: ${liveUtteranceLabel({ source, speaker })}.`
      : liveHasSystemSource
        ? 'Микрофон — пользователь, системный звук — собеседник.'
        : 'Весь разговор слышен одним микрофоном. Метки участников могут быть неизвестны: отвечай только если по последовательности реплик ясно, что последний вопрос задан пользователю, а не самим пользователем.';
    const recentConversation = transcriptText.length > 4000 ? `[… более ранняя часть разговора опущена …]\n${transcriptText.slice(-4000)}` : transcriptText;
    const coachHistory = (session.coachTurns || []).slice(-8).map((turn, index) => `Ход ${index + 1}\nПользователь: ${turn.user}\nПомощник: ${turn.assistant}`).join('\n\n').slice(-4000);
    const modeInstruction = recordingSession?.coachOnly
      ? `РЕЖИМ: AI-ПОМОЩНИК БЕЗ ЗАПИСИ. Быстро найди точный ответ прежде всего в базе знаний и карточках активного пространства. Карточки — только скрытые источники: никогда не показывай их названия и не выгружай их текст вместо готовой реплики. Не создавай конспект и не ссылайся на запись.${continuationMode ? ' Это продолжение уже начатого диалога: следующая реплика может быть ответом, возражением или следующим ходом без вопросительного знака.' : ''}`
      : `РЕЖИМ: ЗАПИСЬ ВСТРЕЧИ С AI-ПОДСКАЗКАМИ. Параллельно с сохранением расшифровки работай как тот же умный помощник: комбинируй релевантные факты пространства в готовую естественную реплику, сохраняй цепочку диалога и используй карточки только как скрытые источники.${continuationMode ? ' Пользователь только что озвучил предыдущую подсказку; последняя реплика — реакция собеседника и следующий ход той же цепочки.' : ''}`;
    const sharedAssistantMode = Boolean(recordingSession?.coachOnly || continuationMode || session.coachScenario?.active);
    const questionSource = source === 'system' ? 'system' : source === 'mic' ? 'mic' : 'unknown';
    const intent = inferAssistantIntent(question);
    const result = await window.sloy.xaiSuggest({ question, intent, assistantMode:sharedAssistantMode, continuationMode:Boolean(continuationMode || session.coachScenario?.active), internetSearch:Boolean(session.coachOnly && loadAiSettings().internetSearch), roleplay:session.coachScenario || null, questionSource, clientRequestId:ticket.id, language:recordingSession?.card?.meetingLanguage || loadAiSettings().transcriptionLanguage || 'uk', context:`${modeInstruction}\n\nТИП ЗАДАЧИ: ${intent}\n\nРОЛИ УЧАСТНИКОВ: ${roleHint}\n\nПРЕДЫДУЩИЕ ХОДЫ ПОМОЩНИКА:\n${coachHistory || 'Пока нет'}\n\nПОСЛЕДНИЙ КОНСПЕКТ:\n${JSON.stringify(recordingSession?.card?.structured || {}).slice(0,1500)}\n\nНЕДАВНЯЯ ХРОНОЛОГИЯ РАЗГОВОРА:\n${recentConversation}\n\nРЕЛЕВАНТНЫЕ ЗНАНИЯ ПРОСТРАНСТВА:\n${getWorkspaceContext(recordingSession?.spaceId, question).slice(0,7000)}` });
    if (!suggestionGate.isCurrent(ticket, session) || recordingSession !== session || session.stopRequested || answerSearchPaused || requestPauseRevision !== answerPauseRevision) return;
    if (result?.reason === 'aborted') return;
    const suggestion = String(result?.suggestion || '').trim();
    if (result?.ok && suggestion && suggestion !== 'NO_SUGGESTION' && suggestion.length <= 6000) {
      lastSuggestedQuestion = question;
      lastSuggestedAt = Date.now();
      const webSources = (Array.isArray(result.sources) ? result.sources : []).slice(0,4).map((source, index) => `${index + 1}. ${String(source.title || 'Источник').trim()} — ${String(source.url || '').trim()}`).filter(line => /https?:\/\//i.test(line));
      const displayedSuggestion = webSources.length ? `${suggestion}\n\nИсточники из интернета:\n${webSources.join('\n')}` : suggestion;
      output.textContent = displayedSuggestion;
      window.sloy?.showAnswerPopup?.({ question, suggestion:displayedSuggestion });
      const providerLabel = { cerebras:'Cerebras', xai:'Grok', gemini:'Gemini', groq:'Groq', bluesminds:'Bluesminds' }[result.provider] || 'AI';
      document.querySelector('#record-status').textContent = result.webGrounded ? `Подсказка готова · ${providerLabel} · интернет` : result.webSearchRequested ? `Подсказка готова · ${providerLabel} · без веб-источников` : `Подсказка готова · ${providerLabel}`;
      rememberCoachTurn(session, question, suggestion, source);
      if (recordingSession?.card && !recordingSession.stopRequested) {
        recordingSession.card.suggestedAnswer = suggestion;
        recordingSession.card.suggestedFor = question;
        recordingSession.card.pinnedSuggestionId = '';
        appendPlaybookEntry(recordingSession.card, question, suggestion);
        scheduleLiveCardsRender(recordingSession);
      }
    }
    else if (result?.suggestion !== 'NO_SUGGESTION' && result?.reason !== 'aborted' && (roleplayFallback || localAnswer)) {
      const fallback = roleplayFallback || localAnswer;
      const fallbackReason = describeAiFailure(result);
      lastSuggestedQuestion = question;
      lastSuggestedAt = Date.now();
      output.textContent = fallback;
      window.sloy?.showAnswerPopup?.({ question, suggestion:fallback });
      rememberCoachTurn(session, question, fallback, source);
      if (recordingSession?.card && !recordingSession.stopRequested) {
        recordingSession.card.suggestedAnswer = fallback;
        recordingSession.card.suggestedFor = question;
        recordingSession.card.pinnedSuggestionId = '';
        appendPlaybookEntry(recordingSession.card, question, fallback);
        scheduleLiveCardsRender(recordingSession);
      }
      document.querySelector('#record-status').textContent = `Локальная подсказка · ${fallbackReason}`;
    }
    else if (result?.suggestion === 'NO_SUGGESTION') {
      output.textContent = heldAnswer
        ? `Текущая реплика не требует нового ответа.\n\nПредыдущая подсказка:\n${heldAnswer}`
        : recordingSession?.coachOnly ? 'Реплика распознана, но вопрос не определён. Сформулируйте его ещё раз.' : 'Жду вопрос или просьбу, обращённую к вам…';
      document.querySelector('#record-status').textContent = 'Реплика обработана · новый ответ не требуется';
    }
    else {
      const reason = String(result?.reason || 'unknown');
      const reasonText = reason === 'missing_key' ? 'Azure распознаёт речь, но для генерации свободного ответа подключите xAI или Groq в ✦ либо обновите локальный ключ Bluesminds.'
        : reason === 'http_401' ? 'Провайдер ответов отклонил API-ключ. Проверьте его в ✦.'
        : reason === 'http_429' ? 'У провайдера ответов закончился доступный лимит запросов.'
        : reason === 'timeout' ? 'Провайдер ответов не успел ответить. Попробуйте ещё раз.'
        : reason.startsWith('http_') ? `Провайдер ответов вернул ошибку ${reason.replace('http_', 'HTTP ')}.`
        : 'Не удалось связаться с провайдером ответов. Распознавание речи продолжается.';
      output.textContent = heldAnswer ? `${reasonText}\n\nПредыдущая подсказка:\n${heldAnswer}` : reasonText;
      document.querySelector('#record-status').textContent = reasonText;
    }
  } finally {
    if (suggestionGate.settle(ticket)) suggestionInFlight = false;
    if (session.pendingCoachTurn?.requestId === ticket.id) session.pendingCoachTurn = null;
  }
}

function renderAnswerPauseState() {
  const button = document.getElementById('answer-pause');
  if (!button) return;
  button.classList.toggle('active', answerSearchPaused);
  button.setAttribute('aria-pressed', String(answerSearchPaused));
  button.textContent = answerSearchPaused ? 'Продолжить · Caps Lock' : 'Заморозить · Caps Lock';
}

function applyAnswerPauseState(state = {}) {
  const paused = Boolean(state.paused);
  if (answerSearchPaused !== paused) answerPauseRevision += 1;
  answerSearchPaused = paused;
  if (paused) resetSuggestionPipeline();
  renderAnswerPauseState();
  if (!recordingSession || recordingSession.stopRequested) return;
  const status = document.getElementById('record-status');
  if (paused) status.textContent = 'Ответ заморожен · новые запросы не запускаются';
  else status.textContent = recordingSession.coachOnly ? 'Поиск продолжен · жду новую реплику' : 'Поиск продолжен · слушаю разговор';
}

window.sloy?.onAnswerPauseState?.(applyAnswerPauseState);

function describeAiFailure(result) {
  const reason = String(result?.reason || 'unknown');
  const providerNames = { cerebras:'Cerebras', xai:'Grok', gemini:'Gemini', groq:'Groq', bluesminds:'Bluesminds' };
  const limited = [...new Set((Array.isArray(result?.rateLimitedProviders) ? result.rateLimitedProviders : []).map(provider => providerNames[provider] || provider))];
  const retrySeconds = Math.max(0, Number(result?.retryAfterSeconds || 0));
  const retryHint = retrySeconds ? ` · повтор через ${formatCooldownDuration(retrySeconds)}` : '';
  if (reason === 'http_429' || reason === 'provider_cooldown') return `${limited.length ? limited.join(', ') : 'AI-провайдеры'} на паузе из-за лимита${retryHint}`;
  if (reason === 'http_401') return 'один із резервних ключів відхилено';
  if (reason === 'empty_result') return 'провайдер повернув порожню відповідь';
  if (reason === 'timeout') return 'провайдер не встиг відповісти';
  if (reason === 'network') return 'тимчасова мережева помилка';
  if (reason === 'missing_key') return 'немає валідного ключа генерації';
  if (reason.startsWith('http_')) return `помилка провайдера ${reason.replace('http_', 'HTTP ')}`;
  return 'невідома помилка провайдера';
}

function formatCooldownDuration(seconds) {
  const value = Math.max(1, Math.ceil(Number(seconds || 0)));
  if (value < 60) return `${value} сек.`;
  if (value < 3600) return `${Math.ceil(value / 60)} мин.`;
  return `${Math.ceil(value / 3600)} ч.`;
}

function rankWorkspaceKnowledgeEntries(spaceId, query = '') {
  const space = workspaces.find(item => item.id === spaceId);
  if (!space) return [];
  const knowledge = workspaceKnowledge(space);
  const normalizedQuery = String(query || '').toLocaleLowerCase('uk-UA');
  const directTerms = (normalizedQuery.match(/[\p{L}\p{N}]{3,}/gu) || []).filter(term => !/^(?:який|яка|яке|які|что|как|это|для|про|the|what|how|with)$/.test(term));
  const semanticGroups = [
    ['переваг','преимущ','плюс','вигод','сильн','benefit','advantage'],
    ['цін','цен','варт','стоим','прайс','оплат','price','cost'],
    ['тривал','длительн','скільки часу','сколько времени','хвилин','минут','duration'],
    ['вік','возраст','років','лет','age'],
    ['запереч','возражен','не цікаво','не интересно','дорого','немає часу','нет времени','objection'],
    ['формат','індивідуаль','индивидуаль','групов','групп','онлайн','offline'],
    ['пробн','пробный','тестов','trial'],
    ['гарант','результ','рейтинг','ліценз','лиценз','сертифік','сертифик']
    ,['питання-заклик','питання заклик','заклик','вопрос-призыв','вопрос призыв','призыв','наступний крок','следующий шаг','cta']
    ,['етап','этап','алгоритм','крок','шаг','послідов','последоват','структур','схем']
  ];
  const expandedTerms = semanticGroups.filter(group => group.some(term => normalizedQuery.includes(term))).flat();
  const searchTerms = dedupeStrings([...directTerms, ...expandedTerms]);
  const relevance = (label, value) => {
    const normalizedLabel = String(label || '').toLocaleLowerCase('uk-UA');
    const normalized = `${normalizedLabel} ${String(value || '').toLocaleLowerCase('uk-UA')}`;
    return searchTerms.reduce((score, term) => {
      const stem = term.length >= 5 ? term.slice(0, -1) : term;
      const bodyScore = normalized.includes(term) ? term.length * 2 : normalized.includes(stem) ? stem.length : 0;
      const titleScore = normalizedLabel.includes(term) ? term.length * 4 : normalizedLabel.includes(stem) ? stem.length * 2 : 0;
      return score + bodyScore + titleScore;
    }, 0);
  };
  const knowledgeEntries = [
    ...(knowledge.summary ? [{ label:'Общая база', text:knowledge.summary, source:'summary' }] : []),
    ...(knowledge.facts || []).map(text => ({ label:'Факт', text, source:'fact' })),
    ...(knowledge.playbook || []).map(item => ({ label:`Готовый ответ · ${item.cue}`, text:item.response, source:'playbook' })),
    ...knowledge.items.map(item => ({ label:item.title || 'Материал', text:item.text || item.summary || '', source:'knowledge' }))
  ];
  const currentHubId = recordingSession?.card?.id;
  const cardEntries = space.cards.filter(card => card.id !== currentHubId).map(card => {
    const holder = document.createElement('div');
    holder.innerHTML = card.content || '';
    const recap = card.structured ? [card.structured.summary, ...(card.structured.keyPoints || [])].filter(Boolean).join('; ') : '';
    const details = card.knowledgeText || recap || card.transcript?.slice(-1500) || card.items?.map(item => item.text).join('; ') || card.links?.map(link => `${link.label}: ${link.url}`).join('; ') || holder.innerText || holder.textContent || '';
    return { label:`Карточка · ${card.title || 'Заметка'}`, text:details, source:'card' };
  });
  return [...knowledgeEntries, ...cardEntries]
    .map((entry, index) => ({ ...entry, index, score:relevance(entry.label, entry.text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function findLocalWorkspaceAnswer(spaceId, query = '') {
  const asksAboutCallToAction = /(?:питан[^\s\-–—]*\s*[\-–—]?\s*заклик|вопрос[^\s\-–—]*\s*[\-–—]?\s*призыв)/iu.test(String(query || ''));
  if (asksAboutCallToAction) {
    return 'Питання-заклик потрібне, щоб перевести розмову від обговорення до конкретного наступного кроку. Після виявлення потреби, уточнення й аргументу воно допомагає не залишити рішення у невизначеному «я подумаю», а запропонувати простий вибір без тиску. Наприклад: «Пробний урок зручніше сьогодні чи завтра?» або «У першій чи другій половині дня?»';
  }
  const ranked = rankWorkspaceKnowledgeEntries(spaceId, query);
  const topScore = Number(ranked[0]?.score || 0);
  if (!topScore) return '';
  const selected = [];
  const seen = new Set();
  for (const entry of ranked) {
    if (entry.score < topScore * .42 || selected.length >= 3) break;
    const text = String(entry.text || '').trim();
    const fingerprint = text.toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, ' ').slice(0,180);
    if (!text || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    selected.push({ ...entry, text:text.slice(0,1800) });
  }
  if (!selected.length) return '';
  const wantsReadyResponse = /(?:что|що)\s+(?:ответить|відповісти|сказать|сказати)|как\s+(?:ответить|сказать|реагировать)|як\s+(?:відповісти|сказати|реагувати)|(?:дай|підкажи|предложи|запропонуй)\s+(?:ответ|відповідь|реплик|фраз)|what should (?:i|we) say|how (?:do|should) (?:i|we) respond/i.test(String(query || ''));
  const wantsStructuredList = /(?:сколько|скільки|какие|які|назови|назвіть|перечисли|перелічи|этап|етап|алгоритм|шаг|крок|структур)/i.test(String(query || ''));
  const readyResponse = wantsReadyResponse ? selected.find(entry => entry.source === 'playbook') : null;
  if (readyResponse) return readyResponse.text;
  const structuredSource = wantsStructuredList ? selected.find(entry => entry.source !== 'playbook') : null;
  if (structuredSource) return structuredSource.text;
  const facts = dedupeStrings(selected.flatMap(entry => entry.text.split(/\n+|;\s+|(?<=[.!?])\s+/))
    .map(part => part.replace(/^[•\-–—\d.)\s]+/, '').trim())
    .filter(part => part.length >= 12 && part.length <= 500)).slice(0,8);
  if (!facts.length) return '';
  return facts.length === 1 ? facts[0] : facts.map(point => `• ${point}`).join('\n');
}

function getWorkspaceContext(spaceId, query = '') {
  const ranked = rankWorkspaceKnowledgeEntries(spaceId, query);
  const relevant = ranked.filter(entry => entry.score > 0);
  const topScore = Number(relevant[0]?.score || 0);
  const core = ranked.filter(entry => ['summary','fact'].includes(entry.source));
  const fallback = ranked.filter(entry => ['knowledge','playbook','card'].includes(entry.source));
  const candidates = relevant.length
    ? [...relevant.filter(entry => entry.score >= Math.max(1, topScore * .24)), ...core]
    : [...core, ...fallback];
  const selected = [];
  const seen = new Set();
  for (const entry of candidates) {
    if (selected.length >= (relevant.length ? 5 : 6)) break;
    const text = String(entry.text || '').replace(/\n{3,}/g, '\n\n').trim();
    const fingerprint = text.toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, ' ').slice(0,220);
    if (!text || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    selected.push({ ...entry, text:text.slice(0,1100) });
  }
  const intent = inferAssistantIntent(query);
  const evidence = selected.map((entry, index) => `[${index + 1}] ${entry.label}\n${entry.text}`).join('\n\n');
  return `ЗАПИТ КОРИСТУВАЧА: ${String(query || '').slice(0,800)}\nТИП ЗАДАЧІ: ${intent}\n\nДОКАЗОВИЙ ПАКЕТ ІЗ БАЗИ ЗНАНЬ (використовуй лише доречне, назви джерел не показуй):\n\n${evidence || 'Релевантних внутрішніх фактів не знайдено.'}`.slice(0,7000);
}

function scheduleLiveCardsRender(session = recordingSession) {
  clearTimeout(liveCardRenderTimer);
  liveCardRenderTimer = setTimeout(() => {
    safeJsonStorageSet(SPACES_KEY, workspaces);
    if (session?.card) syncDetachedMeetingWindow(session.card);
    if (session && session.spaceId === activeSpaceId) {
      cards = (workspaces.find(space => space.id === session.spaceId) || activeSpace()).cards;
      render();
    }
  }, 450);
}

function applyRecapToLiveCards(session, recap, source = 'local') {
  if (!session?.card || !recap) return;
  if (source === 'local' && session.card.structuredSource === 'ai') return;
  session.card.structured = mergeStructuredRecap(session.card, recap);
  session.card.structuredSource = source;
}

async function maybeStructureLiveConversation(session) {
  if (!session || session.stopRequested || liveStructureInFlight || !window.sloy?.xaiStructure) return;
  const meetingText = aggregateMeetingTranscript(session.card, { ...session.segment, transcript:transcriptText });
  const longMeeting = meetingText.length > 50000;
  const enoughNewText = meetingText.length - lastLiveStructureLength >= (longMeeting ? 5000 : 700);
  const enoughTime = Date.now() - lastLiveStructureAt >= (longMeeting ? 120000 : 35000);
  if (meetingText.length < 220 || (!enoughNewText && !enoughTime)) return;
  liveStructureInFlight = true;
  const operationId = beginCardAiProgress(session.card, 'Обновляю важное по ходу разговора');
  lastLiveStructureAt = Date.now();
  lastLiveStructureLength = meetingText.length;
  try {
    const transcriptForUpdate = longMeeting ? `Продолжение длинной встречи:\n${meetingText.slice(-42000)}` : meetingText;
    const accumulatedRecap = JSON.stringify(session.card.structured || {}).slice(0,32000);
    const structureContext = `${getWorkspaceContext(session.spaceId).slice(0,12000)}\n\nУже накопленный конспект этой встречи (не теряй его важные пункты):\n${accumulatedRecap}`;
    const result = await window.sloy.xaiStructure({ transcript:transcriptForUpdate, language:session.card.meetingLanguage || 'auto', workspaceContext:structureContext, operationId });
    if (result?.ok && recordingSession === session && !session.stopRequested) {
      applyRecapToLiveCards(session, result.structured, 'ai');
      scheduleLiveCardsRender(session);
    }
  } finally { endCardAiProgress(operationId); liveStructureInFlight = false; }
}

function syncLiveSessionCards() {
  const session = recordingSession;
  if (!session?.card || session.stopRequested) return;
  session.segment.transcript = transcriptText.trim();
  session.card.transcript = aggregateMeetingTranscript(session.card, session.segment);
  const previousSeconds = (session.card.segments || []).reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0);
  session.card.duration = formatDuration(previousSeconds + (Date.now() - session.startedAt) / 1000);
  const recap = buildLocalSummary(session.card.transcript);
  if (recap) {
    applyRecapToLiveCards(session, recap);
  }
  syncDetachedMeetingWindow(session.card);
  scheduleLiveCardsRender(session);
  void maybeStructureLiveConversation(session);
}

function finishRecordingPreflight(allowed) {
  const resolve = resolveRecordingPreflight;
  resolveRecordingPreflight = null;
  recordingPreflightPromise = null;
  if (recordingPreflightDialog?.open) recordingPreflightDialog.close();
  resolve?.(Boolean(allowed));
}

function ensureRecordingPreflight() {
  if (safeStorageGet('sloy.recording-preflight.v1') === '1') return Promise.resolve(true);
  if (!recordingPreflightDialog) return Promise.resolve(true);
  if (recordingPreflightPromise) return recordingPreflightPromise;
  const settings = loadAiSettings();
  document.getElementById('recording-system-audio').checked = Boolean(settings.captureSystemAudio);
  document.getElementById('recording-participant-consent').checked = false;
  recordingPreflightPromise = new Promise(resolve => { resolveRecordingPreflight = resolve; });
  recordingPreflightDialog.showModal();
  return recordingPreflightPromise;
}

function coachOnlySessionActive() {
  return Boolean(recordingSession?.coachOnly && !recordingSession.stopRequested);
}

function restoreCaptureControls() {
  document.body.classList.remove('recording-active', 'coach-only-active');
  recordPanel.hidden = true;
  document.getElementById('record-stop').disabled = false;
  document.getElementById('record-stop').textContent = 'Пауза';
  document.getElementById('record-finish').hidden = false;
  document.getElementById('record-mark').hidden = false;
  document.getElementById('record-speaker-role').hidden = true;
  const systemSourceButton = document.getElementById('record-source-system');
  systemSourceButton.disabled = true;
  systemSourceButton.classList.remove('active');
  systemSourceButton.setAttribute('aria-pressed', 'false');
  systemSourceButton.textContent = 'Компьютер · выключен';
  coachButton.classList.remove('active');
  coachButton.disabled = false;
  coachButton.querySelector('em').textContent = 'AI-помощник';
  coachButton.setAttribute('aria-label', 'Включить AI-помощника без записи аудио');
  recordButton.disabled = false;
}

async function stopCoachOnly({ silent = false } = {}) {
  const session = recordingSession;
  if (!session?.coachOnly || session.stopRequested) return;
  session.stopRequested = true;
  resetSuggestionPipeline();
  recordingStarting = false;
  document.getElementById('record-status').textContent = 'Отключаю распознавание речи…';
  document.getElementById('record-stop').disabled = true;
  coachButton.disabled = true;
  window.sloy?.setAnswerPopupRecording?.(false);
  clearTimeout(speechRestartTimer);
  speechRestartTimer = null;
  try { speechRecognition?.stop(); } catch {}
  speechRecognition = null;
  await stopLiveTranscription();
  recordingSourceStreams.forEach(stream => stream.getTracks().forEach(track => { try { track.stop(); } catch {} }));
  mediaStream?.getTracks().forEach(track => { try { track.stop(); } catch {} });
  recordingSourceStreams = [];
  mediaStream = null;
  clearInterval(recordTimer);
  recordTimer = null;
  if (recordingSession === session) recordingSession = null;
  restoreCaptureControls();
  if (!silent) showToast('AI-помощник выключен · аудио и расшифровка не сохранялись');
}

async function startCoachOnly() {
  if (coachOnlySessionActive()) { await stopCoachOnly(); return; }
  if (recordingSession) { showToast('Сначала дождитесь завершения текущей операции'); return; }
  if (recordingStarting || recordingFinishing) { showToast('Подождите завершения текущей операции'); return; }
  recordingStarting = true;
  resetSuggestionPipeline({ resetLast:true });
  coachButton.disabled = true;
  try {
    const settings = { ...loadAiSettings(), liveTranscription:true, liveSuggestions:true };
    document.getElementById('live-coach').hidden = false;
    document.getElementById('live-suggestion').textContent = 'Говорите со мной естественно: задайте вопрос, опишите проблему или попросите подготовить ответ…';
    document.getElementById('live-outline-panel').hidden = false;
    document.getElementById('live-outline').textContent = 'Подключаю распознавание речи. Ничего не будет сохранено.';
    transcriptText = '';
    liveUtterances = [];
    liveInterim.mic = liveInterim.system = '';
    liveLastFinal.mic = liveLastFinal.system = '';
    resetLiveSuggestionTurns();

    const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 } });
    recordingSourceStreams = [microphoneStream];
    mediaStream = microphoneStream;
    let systemStream = null;
    if (settings.captureSystemAudio) {
      try {
        systemStream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true });
        recordingSourceStreams.push(systemStream);
        systemStream.getVideoTracks().forEach(track => { track.enabled = false; });
      } catch { showToast('Звук компьютера не подключён · помощник слушает микрофон'); }
    }

    recordStartedAt = Date.now();
    recordingSpaceId = activeSpaceId;
    recordingSession = {
      id:`coach-${crypto.randomUUID()}`, coachOnly:true, card:null, startedAt:recordStartedAt,
      spaceId:recordingSpaceId, stopRequested:false, systemStream,
      systemAudioEnabled:Boolean(systemStream?.getAudioTracks().length), userSpeakerId:'',
      coachTurns:[], coachDialogueUntil:0, coachScenario:null,
      lastAssistantSuggestion:'', lastAssistantSuggestionAt:0, awaitingInterlocutor:false, readbackAt:0, pendingCoachTurn:null
    };
    const session = recordingSession;
    document.body.classList.add('recording-active', 'coach-only-active');
    recordPanel.hidden = false;
    document.getElementById('record-time').textContent = '00:00';
    document.getElementById('record-status').textContent = 'AI-помощник слушает · без записи аудио';
    document.getElementById('record-transcript').textContent = 'Речь появится здесь…';
    document.getElementById('record-stop').textContent = 'Выключить помощника';
    document.getElementById('record-stop').disabled = false;
    document.getElementById('record-finish').hidden = true;
    document.getElementById('record-mark').hidden = true;
    coachButton.classList.add('active');
    coachButton.disabled = false;
    coachButton.querySelector('em').textContent = 'Выключить помощника';
    coachButton.setAttribute('aria-label', 'Выключить AI-помощника');
    recordButton.disabled = true;
    window.sloy?.setAnswerPopupRecording?.(true);
    recordTimer = setInterval(() => document.getElementById('record-time').textContent = formatDuration((Date.now() - recordStartedAt) / 1000), 500);
    const sourceButton = document.getElementById('record-source-system');
    const hasSystem = Boolean(systemStream?.getAudioTracks().length);
    sourceButton.textContent = hasSystem ? 'Компьютер · включён' : 'Компьютер · выключен';
    sourceButton.classList.toggle('active', hasSystem);
    sourceButton.disabled = !hasSystem;
    sourceButton.setAttribute('aria-pressed', String(hasSystem));
    document.getElementById('record-speaker-role').hidden = true;

    let liveStarted = false;
    try { liveStarted = await startLiveTranscription(settings, microphoneStream, systemStream); } catch {}
    if (session.stopRequested || recordingSession !== session) { if (liveStarted) await stopLiveTranscription(); return; }
    if (!liveStarted) {
      let browserStarted = false;
      try { browserStarted = startSpeechRecognition(); } catch {}
      if (!browserStarted) {
        await stopCoachOnly({ silent:true });
        showToast('Не удалось включить распознавание · подключите Azure, xAI или Groq в ✦');
        return;
      }
      document.getElementById('record-status').textContent = 'AI-помощник распознаёт микрофон · без сохранения';
    }
    recordingStarting = false;
    showToast('AI-помощник включён · ничего не записывается');
  } catch {
    recordingStarting = false;
    if (recordingSession?.coachOnly) await stopCoachOnly({ silent:true });
    else {
      recordingSourceStreams.forEach(stream => stream.getTracks().forEach(track => { try { track.stop(); } catch {} }));
      recordingSourceStreams = [];
      mediaStream = null;
      restoreCaptureControls();
    }
    showToast('Нет доступа к микрофону. Проверьте настройки Windows');
  }
}

async function startRecording(forceNew = false) {
  if (coachOnlySessionActive()) { showToast('Сначала выключите AI-помощника'); return; }
  if (recordingStarting || recordingFinishing || recordingSession) { showToast('Предыдущая операция ещё завершается…'); return; }
  recordingStarting = true;
  if (!await ensureRecordingPreflight()) { recordingStarting = false; return; }
  resetSuggestionPipeline({ resetLast:true });
  showToast('🎤 Підключаю мікрофон і починаю слухати…');
  try {
    document.getElementById('live-coach').hidden = false;
    document.getElementById('live-suggestion').textContent = 'Жду вопрос или просьбу, обращённую к вам…';
    document.getElementById('live-outline-panel').hidden = false;
    document.getElementById('live-outline').textContent = 'Подключаю расшифровку и жду первые реплики…';
    lastLiveStructureAt = 0;
    lastLiveStructureLength = 0;
    const settings = loadAiSettings();
    const originSpace = activeSpace();
    const existingMeeting = forceNew ? null : activeMeeting(originSpace);
    const meetingId = existingMeeting?.id || crypto.randomUUID();
    const segment = { id:crypto.randomUUID(), startedAt:Date.now(), endedAt:null, durationSeconds:0, transcript:'', audioSrc:'', sourceAudio:{}, status:'recording' };
    const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 } });
    recordingSourceStreams = [microphoneStream];
    let systemStream = null;
    if (settings.captureSystemAudio) {
      try {
        systemStream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true });
        recordingSourceStreams.push(systemStream);
        systemStream.getVideoTracks().forEach(track => { track.enabled = false; });
      } catch { showToast('Звук компьютера недоступен — записываю только микрофон'); }
    }
    if (systemStream?.getAudioTracks().length) {
      recordingAudioContext = new AudioContext();
      const destination = recordingAudioContext.createMediaStreamDestination();
      recordingAudioContext.createMediaStreamSource(microphoneStream).connect(destination);
      recordingAudioContext.createMediaStreamSource(new MediaStream(systemStream.getAudioTracks())).connect(destination);
      mediaStream = destination.stream;
    } else {
      mediaStream = microphoneStream;
    }
    audioChunks = [];
    transcriptText = '';
    liveUtterances = [];
    resetLiveSuggestionTurns();
    const preferredMime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const options = preferredMime ? { mimeType:preferredMime } : {};
    separateRecordings = [createSourceRecording(microphoneStream, 'mic', options)];
    if (systemStream?.getAudioTracks().length) separateRecordings.push(createSourceRecording(systemStream, 'system', options));
    mediaRecorder = new MediaRecorder(mediaStream, options);
    recordStartedAt = Date.now();
    recordingSpaceId = activeSpaceId;
    recordingSession = {
      id:meetingId, segmentId:segment.id, segment, recorder:mediaRecorder, chunks:audioChunks,
      sourceRecordings:separateRecordings.slice(), startedAt:recordStartedAt,
      spaceId:recordingSpaceId, liveStopPromise:Promise.resolve(),
      stopRequested:false, finalizing:false, card:existingMeeting || null,
      systemStream, systemAudioEnabled:Boolean(systemStream?.getAudioTracks().length), userSpeakerId:'',
      coachTurns:[], coachDialogueUntil:0, coachScenario:null,
      lastAssistantSuggestion:'', lastAssistantSuggestionAt:0, awaitingInterlocutor:false, readbackAt:0, pendingCoachTurn:null
    };
    const session = recordingSession;
    mediaRecorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
    mediaRecorder.onstop = () => finishRecording(session);
    mediaRecorder.onerror = () => stopRecording();
    mediaRecorder.start(1000);
    createRecordingCard(session);
    recordingStarting = false;
    selectedIds.clear();
    updateSelectionBar();
    document.body.classList.add('recording-active');
    window.sloy?.setAnswerPopupRecording?.(true);
    recordPanel.hidden = false;
    document.querySelector('#record-time').textContent = '00:00';
    document.querySelector('#record-status').textContent = 'Записываю разговор';
    document.querySelector('#record-transcript').textContent = 'Слушаю…';
    document.querySelector('#record-stop').disabled = false;
    recordButton.classList.add('recording');
    recordButton.querySelector('em').textContent = 'Выключить запись';
    recordButton.setAttribute('aria-label', 'Выключить запись разговора');
    coachButton.disabled = true;
    recordTimer = setInterval(() => document.querySelector('#record-time').textContent = formatDuration((Date.now() - recordStartedAt) / 1000), 500);
    const systemSourceButton = document.getElementById('record-source-system');
    systemSourceButton.textContent = systemStream?.getAudioTracks().length ? 'Компьютер · включён' : 'Компьютер · выключен';
    systemSourceButton.classList.toggle('active', Boolean(systemStream?.getAudioTracks().length));
    systemSourceButton.disabled = !systemStream?.getAudioTracks().length;
    systemSourceButton.setAttribute('aria-pressed', String(Boolean(systemStream?.getAudioTracks().length)));
    document.getElementById('record-speaker-role').hidden = true;
    let liveStarted = false;
    try { liveStarted = await startLiveTranscription(settings, microphoneStream, systemStream); }
    catch (error) {
      liveStarted = false;
      session.card.processing = `error:${error?.message || 'live_start'}`;
      document.querySelector('#record-status').textContent = `Записываю аудио · live-STT не запущен (${error?.message || 'ошибка'})`;
      scheduleLiveCardsRender(session);
    }
    if (session.stopRequested || recordingSession !== session) { if (liveStarted) session.liveStopPromise = stopLiveTranscription(); return; }
    if (!liveStarted) {
      let browserStt = false;
      try { browserStt = startSpeechRecognition(); } catch {}
      if (!browserStt && !String(session.card.processing || '').startsWith('error:')) document.querySelector('#record-status').textContent = 'Записываю аудио · подключите xAI или Groq для текста';
    } else {
      session.card.processing = 'live:listening';
      session.card.provider = liveProvider;
      scheduleLiveCardsRender(session);
    }
    showToast(settings.captureSystemAudio && systemStream?.getAudioTracks().length
      ? 'Микрофон и звук компьютера записываются'
      : 'Слышен только микрофон · подключите звук компьютера в настройках ✦');
  } catch (error) {
    recordingStarting = false;
    window.sloy?.setAnswerPopupRecording?.(false);
    if (recordingSession && !recordingSession.stopRequested) { stopRecording(); return; }
    recordingSourceStreams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    mediaStream?.getTracks().forEach(track => track.stop());
    try { await recordingAudioContext?.close(); } catch {}
    recordingSourceStreams = [];
    recordingAudioContext = null;
    mediaRecorder = null;
    separateRecordings = [];
    document.body.classList.remove('recording-active');
    recordPanel.hidden = true;
    showToast('Нет доступа к микрофону. Проверьте настройки Windows');
  }
}

function startSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return false;
  if (speechRecognition) return true;
  clearTimeout(speechRestartTimer);
  const session = recordingSession;
  const recognition = new Recognition();
  speechRecognition = recognition;
  const language = loadAiSettings().transcriptionLanguage;
  recognition.lang = language === 'uk' ? 'uk-UA' : language === 'en' ? 'en-US' : language === 'ru' ? 'ru-RU' : (navigator.language || 'ru-RU');
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = event => {
    speechRestartAttempts = 0;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        const clean = phrase.trim();
        const added = appendLiveUtterance('mic', clean);
        if (added && liveSuggestionsEnabled()) scheduleLiveSuggestion(clean, 'mic');
      }
      else interim += phrase;
    }
    document.querySelector('#record-transcript').textContent = (transcriptText + interim).trim() || 'Слушаю…';
    syncLiveSessionCards();
  };
  recognition.onerror = () => { document.querySelector('#record-status').textContent = recordingSession?.coachOnly ? 'Распознавание речи переподключается…' : 'Записываю аудио · восстанавливаю расшифровку'; };
  recognition.onend = () => {
    if (!window.SloyRecordingRuntime.shouldRestartRecognition({ instance:recognition, current:speechRecognition, session, currentSession:recordingSession, stopRequested:session?.stopRequested, finishing:recordingFinishing })) return;
    speechRecognition = null;
    const delay = Math.min(4000, 500 * (2 ** Math.min(3, speechRestartAttempts++)));
    speechRestartTimer = setTimeout(() => {
      if (recordingSession === session && !session.stopRequested && !recordingFinishing) startSpeechRecognition();
    }, delay);
  };
  try { recognition.start(); return true; } catch { if (speechRecognition === recognition) speechRecognition = null; return false; }
}

function buildLocalSummary(text) {
  const sentences = String(text).replace(/\[(Вы|Собеседник[^\]]*)\]\s*/g, '').split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(value => value.length > 12);
  if (!sentences.length) return null;
  const unique = dedupeStrings(sentences);
  const tasks = unique.filter(value => /\b(нужно|надо|сделать|подготовить|отправить|проверить|уточнить|договорились|потрібно|треба|зробити|підготувати|надіслати|перевірити|уточнити|домовились|need|must|prepare|send|check|clarify|agreed)\b/i.test(value)).slice(0,5).map(title => ({ title, owner:null, due:null }));
  const questions = unique.filter(value => /\?$/.test(value)).slice(0,4);
  return { summary:unique.slice(-3).join(' ').slice(0,700), keyPoints:unique.slice(-8), decisions:[], topics:[], playbook:[], tasks, questions };
}

function createRecordingCard(session) {
  if (session.card) {
    session.card.meetingState = session.stopRequested ? 'pausing' : 'active';
    session.card.live = !session.stopRequested;
    session.card.processing = session.stopRequested ? 'saving' : 'live:connecting';
    session.card.activeSegmentId = session.segmentId;
    persistWorkspaces();
    if (session.spaceId !== activeSpaceId) switchSpace(session.spaceId);
    else render();
    return session.card;
  }
  const now = new Intl.DateTimeFormat('uk-UA', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' }).format(new Date());
  const card = {
    id:session.id, createdAt:Date.now(), type:'transcript', size:'large', accent:'#e16663',
    kicker:'Розмова', title:`Запис · ${now}`, transcript:transcriptText.trim(),
    duration:formatDuration((Date.now() - session.startedAt) / 1000), audioSrc:'', sourceAudio:{}, processing:session.stopRequested ? 'saving' : 'live:connecting', live:!session.stopRequested,
    meetingVersion:1, meetingState:session.stopRequested ? 'pausing' : 'active', segments:[], activeSegmentId:session.segmentId, revision:0, meetingLanguage:loadAiSettings().transcriptionLanguage || 'uk'
  };
  const targetSpace = workspaces.find(space => space.id === session.spaceId) || activeSpace();
  const placement = findMeetingBoardPlacement(targetSpace);
  if (placement) card.position = placement;
  else card.detachedMeeting = true;
  targetSpace.cards.unshift(card);
  targetSpace.activeMeetingId = card.id;
  session.card = card;
  persistWorkspaces();
  // Always switch to the space where the card was created so user can see it
  if (targetSpace.id !== activeSpaceId) {
    switchSpace(targetSpace.id);
  } else {
    cards = targetSpace.cards;
    render();
  }
  if (card.detachedMeeting) showToast('Доска заполнена · встреча открыта отдельным окном поверх приложений');
  return card;
}

function stopRecording() {
  const session = recordingSession;
  if (session?.coachOnly) { void stopCoachOnly(); return; }
  if (!session || session.stopRequested) return;
  session.stopRequested = true;
  session.stopRequestedAt = Date.now();
  resetSuggestionPipeline();
  window.sloy?.setAnswerPopupRecording?.(false);
  recordingFinishing = true;
  const liveCard = createRecordingCard(session);
  liveCard.live = false;
  liveCard.processing = 'saving';
  syncDetachedMeetingWindow(liveCard);
  document.querySelector('#record-status').textContent = 'Завершаю и сохраняю запись…';
  document.querySelector('#record-stop').disabled = true;
  session.sourceRecordings.forEach(entry => {
    try { if (entry.recorder.state !== 'inactive') { entry.recorder.requestData?.(); entry.recorder.stop(); } else entry.finish(); }
    catch { entry.finish(); }
    setTimeout(entry.finish, 5000);
  });
  session.liveStopPromise = stopLiveTranscription();
  liveStopPromise = session.liveStopPromise;
  try { speechRecognition?.stop(); } catch {}
  speechRecognition = null;
  clearInterval(recordTimer);
  recordButton.classList.remove('recording');
  recordButton.disabled = true;
  recordButton.querySelector('em').textContent = 'Сохранение…';
  recordButton.setAttribute('aria-label', 'Запись завершается');
  try {
    if (session.recorder.state !== 'inactive') { session.recorder.requestData?.(); session.recorder.stop(); }
    else finishRecording(session);
  } catch {
    finishRecording(session);
  }
  setTimeout(() => { if (!session.finalizing) finishRecording(session); }, 5000);
}

function requestHide() {
  // Hiding/minimizing the overlay must never control the recorder. Only the
  // explicit recording controls are allowed to pause or finish a meeting.
  window.sloy?.hide();
}

async function finishRecording(session = recordingSession) {
  if (!session || session.finalizing) return;
  session.finalizing = true;
  const recorder = session.recorder;
  const chunks = session.chunks.slice();
  const sourceRecordings = session.sourceRecordings.slice();
  const startedAt = session.startedAt;
  const targetSpaceId = session.spaceId;
  try {
  recordingSourceStreams.forEach(stream => stream.getTracks().forEach(track => { try { track.stop(); } catch {} }));
  mediaStream?.getTracks().forEach(track => { try { track.stop(); } catch {} });
  try { await recordingAudioContext?.close(); } catch {}
  recordingSourceStreams = [];
  recordingAudioContext = null;
  await window.SloyRecordingRuntime.withDeadline(session.liveStopPromise, 6000, null);
  const durationMs = Number(session.stopRequestedAt || Date.now()) - startedAt;
  const sessionTranscript = transcriptText.trim();
  const duration = formatDuration(durationMs / 1000);
  const mimeType = recorder.mimeType || 'audio/webm';
  const blob = new Blob(chunks, { type:mimeType });
  const audioBytes = await blob.arrayBuffer();
  let audioSrc = '';
  const sourceAudio = {};
  if (window.sloy?.saveAudio) {
    const saved = await window.sloy.saveAudio({ bytes:audioBytes, mimeType });
    audioSrc = saved.url;
    const sourceBlobs = await Promise.all(sourceRecordings.map(async entry => ({ sourceName:entry.sourceName, blob:await entry.done })));
    for (const item of sourceBlobs) {
      const sourceMime = item.blob.type || mimeType;
      const savedSource = await window.sloy.saveAudio({ bytes:await item.blob.arrayBuffer(), mimeType:sourceMime });
      sourceAudio[item.sourceName] = savedSource.url;
    }
  }
  const recordingCard = createRecordingCard(session);
  const segment = session.segment;
  segment.endedAt = Date.now();
  segment.durationSeconds = durationMs / 1000;
  segment.transcript = sessionTranscript;
  segment.audioSrc = audioSrc;
  segment.sourceAudio = sourceAudio;
  segment.status = 'saved';
  recordingCard.segments ||= [];
  const segmentIndex = recordingCard.segments.findIndex(item => item.id === segment.id);
  if (segmentIndex >= 0) recordingCard.segments[segmentIndex] = segment;
  else recordingCard.segments.push(segment);
  recordingCard.transcript = aggregateMeetingTranscript(recordingCard);
  recordingCard.duration = formatDuration(recordingCard.segments.reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0));
  recordingCard.audioSrc = audioSrc;
  recordingCard.sourceAudio = sourceAudio;
  recordingCard.processing = '';
  recordingCard.live = false;
  recordingCard.meetingState = 'paused';
  recordingCard.activeSegmentId = null;
  recordingCard.revision = Number(recordingCard.revision || 0) + 1;
  if (recordingCard.structuredSource !== 'ai') {
    recordingCard.structured = buildLocalSummary(recordingCard.transcript);
    recordingCard.structuredSource = 'local';
  }
  syncDetachedMeetingWindow(recordingCard);
  const targetSpace = workspaces.find(space => space.id === targetSpaceId) || activeSpace();
  if (targetSpace.id === activeSpaceId) cards = targetSpace.cards;
  persistWorkspaces();
  showToast(sessionTranscript ? 'Встреча поставлена на паузу · сегмент сохранён' : 'Аудиосегмент сохранён · встреча на паузе');
  if (session.finalizeAfterSave) finalizeMeeting(recordingCard.id);
  render();
  const aiSettings = loadAiSettings();
  void processMeetingSegmentWithAi(recordingCard, segment, audioBytes, mimeType, aiSettings, targetSpaceId).catch(() => {
    recordingCard.processing = 'error:ai';
    persistWorkspaces();
    if (targetSpaceId === activeSpaceId) render();
  });
  } catch (error) {
    if (session.card) {
      session.card.processing = 'error:save';
      session.card.meetingState = 'paused';
      session.card.live = false;
      session.card.activeSegmentId = null;
      if (session.segment) session.segment.status = 'error';
      syncDetachedMeetingWindow(session.card);
    }
    showToast('Не вдалося повністю зберегти запис');
  } finally {
    audioChunks = [];
    separateRecordings = [];
    const ownsSession = recordingSession === session;
    if (ownsSession) recordingSession = null;
    if (mediaRecorder === recorder) mediaRecorder = null;
    if (ownsSession) {
      recordingFinishing = false;
      recordingStarting = false;
      document.body.classList.remove('recording-active');
      recordPanel.hidden = true;
      clearInterval(recordTimer);
      document.querySelector('#record-stop').disabled = false;
      recordButton.classList.remove('recording');
      recordButton.disabled = false;
      recordButton.querySelector('em').textContent = 'Включить запись';
      recordButton.setAttribute('aria-label', 'Включить запись разговора');
      coachButton.disabled = false;
    }
    const systemSourceButton = document.getElementById('record-source-system');
    systemSourceButton.disabled = true;
    systemSourceButton.classList.remove('active');
    systemSourceButton.setAttribute('aria-pressed', 'false');
    systemSourceButton.textContent = 'Компьютер · выключен';
    document.getElementById('record-speaker-role').hidden = true;
    // Refresh cards from the target space so the saved card is visible
    const savedSpace = workspaces.find(s => s.id === targetSpaceId);
    if (savedSpace) {
      if (savedSpace.id === activeSpaceId) {
        cards = savedSpace.cards;
      }
    }
    persistWorkspaces();
    render();
  }
}

async function processMeetingSegmentWithAi(card, segment, audioBytes, mimeType, settings, spaceId) {
  const requestedRevision = Number(card.revision || 0);
  const status = await window.sloy?.xaiKeyStatus?.();
  const hasTranscriptionAi = Boolean(status?.providers?.groq || status?.providers?.xai);
  const hasAnswerAi = Boolean(status?.answerConfigured);
  if (!segment.transcript && settings.autoTranscribe && hasTranscriptionAi) {
    card.processing = 'transcribing';
    persistWorkspaces();
    if (spaceId === activeSpaceId) render();
    const result = await window.sloy.xaiTranscribe({ bytes:audioBytes, mimeType, language:card.meetingLanguage || settings.transcriptionLanguage || 'auto' });
    if (result?.ok) {
      segment.transcript = dedupeTranscriptText(result.transcript?.text || '');
      segment.batchTranscript = segment.transcript;
      segment.words = result.transcript?.words || [];
      card.transcript = aggregateMeetingTranscript(card);
      card.aiTranscribedAt = Date.now();
      delete card.aiLastFailedAt;
    } else {
      card.processing = `error:${result?.reason || 'transcription'}`;
      card.aiLastFailedAt = Date.now();
    }
  }
  if (settings.autoStructure && hasAnswerAi && card.transcript) {
    card.processing = 'structuring';
    const operationId = beginCardAiProgress(card, 'Собираю конспект из всей встречи');
    persistWorkspaces();
    if (spaceId === activeSpaceId) render();
    const result = await window.sloy.xaiStructure({ transcript:card.transcript, language:card.meetingLanguage || settings.transcriptionLanguage || 'auto', workspaceContext:getWorkspaceContext(spaceId), operationId });
    endCardAiProgress(operationId);
    if (Number(card.revision || 0) !== requestedRevision) return;
    if (result?.ok) {
      card.structured = mergeStructuredRecap(card, result.structured);
      card.structuredSource = 'ai';
      card.aiSummaryUpdatedAt = Date.now();
      delete card.aiLastFailedAt;
      card.processing = '';
      if (card.meetingState === 'finalized') {
        const space = workspaces.find(s => s.id === spaceId);
        if (space) importMeetingToKnowledge(space, card);
      }
    } else {
      card.processing = `error:${result?.reason || 'structure'}`;
      card.aiLastFailedAt = Date.now();
    }
  } else if (!hasAnswerAi && status?.providers?.azure) {
    card.processing = '';
  }
  persistWorkspaces();
  if (spaceId === activeSpaceId) render();
}

async function processRecordingWithAi(recordingCard, audioBytes, mimeType, aiSettings) {
  if (aiSettings.autoTranscribe && window.sloy?.xaiTranscribe) {
    const status = await window.sloy.xaiKeyStatus();
    if (!status?.configured) {
      recordingCard.processing = status?.invalidStoredKey ? 'error:invalid_key' : 'error:missing_key';
      safeJsonStorageSet(SPACES_KEY, workspaces);
      render();
      return;
    }
    if (status?.configured) {
      recordingCard.processing = 'transcribing';
      recordingCard.aiLastAction = 'transcribe-summary';
      recordingCard.aiProcessingStartedAt = Date.now();
      safeJsonStorageSet(SPACES_KEY, workspaces); render();
      const result = await window.sloy.xaiTranscribe({ bytes:audioBytes, mimeType, language:aiSettings.transcriptionLanguage || 'auto' });
      if (result?.ok) {
        recordingCard.batchTranscript = result.transcript?.text || '';
        // Batch STT sees the whole recording and is the authoritative final text.
        recordingCard.batchTranscript = dedupeTranscriptText(recordingCard.batchTranscript);
        recordingCard.transcript = recordingCard.batchTranscript || dedupeTranscriptText(recordingCard.transcript);
        recordingCard.words = result.transcript?.words || [];
        recordingCard.aiTranscribedAt = Date.now();
        delete recordingCard.aiLastFailedAt;
        if (aiSettings.autoStructure && recordingCard.transcript) {
          recordingCard.processing = 'structuring';
          const operationId = beginCardAiProgress(recordingCard, 'Собираю конспект из расшифровки');
          safeJsonStorageSet(SPACES_KEY, workspaces); render();
          const structured = await window.sloy.xaiStructure({ transcript:recordingCard.transcript, language:recordingCard.meetingLanguage || loadAiSettings().transcriptionLanguage || 'auto', operationId });
          endCardAiProgress(operationId);
          if (structured?.ok) {
            recordingCard.structured = mergeStructuredRecap(recordingCard, structured.structured);
            recordingCard.structuredSource = 'ai';
            recordingCard.aiSummaryUpdatedAt = Date.now();
            if (recordingCard.meetingState === 'finalized') {
              const space = workspaces.find(s => s.cards.includes(recordingCard)) || activeSpace();
              importMeetingToKnowledge(space, recordingCard);
            }
          }
          else {
            recordingCard.processing = `error:${structured?.reason || 'structure'}`;
            recordingCard.aiLastFailedAt = Date.now();
          }
        }
        if (!String(recordingCard.processing || '').startsWith('error:')) recordingCard.processing = '';
      } else {
        recordingCard.processing = `error:${result?.reason || 'transcription'}`;
        recordingCard.aiLastFailedAt = Date.now();
      }
      safeJsonStorageSet(SPACES_KEY, workspaces);
      showToast(recordingCard.processing ? 'Аудио сохранено, обработку можно повторить позже' : 'Расшифровка и конспект Grok готовы');
      render();
    }
  }
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[c]);
}
function escapeAttr(value = '') { return escapeHtml(String(value)); }

document.querySelector('#primary-add').addEventListener('click', event => {
  event.stopPropagation();
  addMenu.hidden = !addMenu.hidden;
});
addMenu.addEventListener('click', event => {
  const button = event.target.closest('button[data-type]');
  if (button) addCard(button.dataset.type);
});
document.addEventListener('click', event => {
  if (!addMenu.contains(event.target) && event.target.id !== 'primary-add') addMenu.hidden = true;
});
document.querySelectorAll('.view-toggle').forEach(button => button.addEventListener('click', () => setEditMode(button.dataset.view === 'edit' && !editMode)));
document.querySelectorAll('[data-layout]').forEach(button => button.addEventListener('click', () => setLayout(button.dataset.layout)));
document.querySelector('#sort-cards').addEventListener('change', event => setCardSort(event.currentTarget.value));
document.querySelector('#sort-number-button').addEventListener('click', sortActiveCardsByNumber);
document.querySelectorAll('[data-group-size]').forEach(button => button.addEventListener('click', () => applyGroupSize(button.dataset.groupSize)));
document.querySelectorAll('[data-arrange]').forEach(button => button.addEventListener('click', () => arrangeSelected(button.dataset.arrange)));
document.querySelector('#selection-clear').addEventListener('click', () => { selectedIds.clear(); render(); });
document.querySelectorAll('.close-overlay').forEach(button => button.addEventListener('click', requestHide));
document.querySelector('.privacy-toggle').addEventListener('click', () => {
  document.body.classList.toggle('privacy');
  showToast(document.body.classList.contains('privacy') ? 'Содержимое скрыто' : 'Содержимое показано');
});
search.addEventListener('input', () => filterCards(search.value));
recordButton.addEventListener('click', () => {
  if (recordingSession && !recordingSession.stopRequested) {
    stopRecording();
    return;
  }
  void startRecording(false);
});
coachButton.addEventListener('click', () => { void (coachOnlySessionActive() ? stopCoachOnly() : startCoachOnly()); });
document.querySelector('#record-stop').addEventListener('click', () => {
  if (coachOnlySessionActive()) { void stopCoachOnly(); return; }
  stopRecording();
});
document.getElementById('answer-pause')?.addEventListener('click', () => window.sloy?.toggleAnswerPause?.());

(function enableMovableRecordPanel() {
  const handle = document.getElementById('record-panel-drag');
  if (!handle || !recordPanel) return;

  const resetPosition = () => {
    ['left','top','right','bottom','transform'].forEach(property => recordPanel.style.removeProperty(property));
    showToast('Панель помощника возвращена вниз');
  };
  const placePanel = (left, top, width = recordPanel.getBoundingClientRect().width, height = recordPanel.getBoundingClientRect().height) => {
    const x = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    recordPanel.style.left = `${x}px`;
    recordPanel.style.top = `${y}px`;
    recordPanel.style.right = 'auto';
    recordPanel.style.bottom = 'auto';
    recordPanel.style.transform = 'none';
  };

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startRect = recordPanel.getBoundingClientRect();
    const offsetX = event.clientX - startRect.left;
    const offsetY = event.clientY - startRect.top;
    placePanel(startRect.left, startRect.top, startRect.width, startRect.height);
    recordPanel.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    const onMove = moveEvent => placePanel(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, startRect.width, startRect.height);
    const onUp = upEvent => {
      recordPanel.classList.remove('dragging');
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
  handle.addEventListener('dblclick', resetPosition);
  handle.addEventListener('keydown', event => {
    if (event.key === 'Home' || event.key === 'Escape') { event.preventDefault(); resetPosition(); return; }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const rect = recordPanel.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 12;
    placePanel(rect.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), rect.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), rect.width, rect.height);
  });
  window.addEventListener('resize', () => {
    if (recordPanel.style.transform !== 'none') return;
    const rect = recordPanel.getBoundingClientRect();
    placePanel(rect.left, rect.top, rect.width, rect.height);
  });
})();
document.querySelector('#record-source-system').addEventListener('click', event => {
  const session = recordingSession;
  const tracks = session?.systemStream?.getAudioTracks() || [];
  if (!session || session.stopRequested || !tracks.length) {
    showToast('Звук компьютера не подключён к этому отрезку · включить его можно перед следующей записью в ✦');
    return;
  }
  const enabled = !tracks.some(track => track.enabled);
  tracks.forEach(track => { track.enabled = enabled; });
  session.systemAudioEnabled = enabled;
  liveHasSystemSource = enabled;
  rebuildTranscriptFromUtterances();
  syncUserSpeakerControl();
  event.currentTarget.textContent = enabled ? 'Компьютер · включён' : 'Компьютер · выключен';
  event.currentTarget.classList.toggle('active', enabled);
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  showToast(recordingSession.coachOnly
    ? enabled ? 'Помощник снова слышит звук компьютера' : 'Звук компьютера выключен · помощник слушает микрофон'
    : enabled ? 'Звук компьютера снова записывается' : 'Звук компьютера выключен · микрофон продолжает запись');
});
document.querySelector('#record-user-speaker').addEventListener('change', event => {
  if (!recordingSession || recordingSession.stopRequested) return;
  recordingSession.userSpeakerId = event.currentTarget.value;
  rebuildTranscriptFromUtterances();
  document.querySelector('#record-transcript').textContent = transcriptText || 'Слушаю…';
  syncLiveSessionCards();
  showToast(recordingSession.coachOnly
    ? recordingSession.userSpeakerId ? 'Выбран голос, чьи вопросы адресуются AI' : 'AI будет отвечать на вопросы всех голосов в микрофоне'
    : recordingSession.userSpeakerId ? 'Свой голос отмечен · AI не будет отвечать на ваши вопросы' : 'Определение своего голоса снова автоматическое');
});
document.querySelector('#record-finish').addEventListener('click', () => {
  if (!recordingSession || recordingSession.stopRequested) return;
  recordingSession.finalizeAfterSave = true;
  stopRecording();
});
window.sloy?.onMeetingWindowAction?.(({ action, cardId } = {}) => {
  const space = workspaces.find(item => item.cards.some(card => card.id === cardId));
  const card = space?.cards.find(item => item.id === cardId);
  if (!card) return;
  if (action === 'pause' && recordingSession?.card?.id === cardId && !recordingSession.stopRequested) stopRecording();
  if (action === 'resume' && card.meetingState === 'paused') {
    if (space.id !== activeSpaceId) switchSpace(space.id);
    void startRecording(false);
  }
  if (action === 'finish') {
    const matchingSession = recordingSession?.card?.id === cardId ? recordingSession : null;
    const decision = window.SloyRecordingRuntime.meetingFinishDecision({ hasMatchingSession:Boolean(matchingSession), stopRequested:Boolean(matchingSession?.stopRequested), cardState:card.meetingState });
    if (decision.latch) {
      recordingSession.finalizeAfterSave = true;
      if (decision.command === 'stop') stopRecording();
      else syncDetachedMeetingWindow(card);
    } else if (decision.command === 'finalize') finalizeMeeting(cardId);
  }
});
document.querySelector('#record-mark').addEventListener('click', () => {
  if (!recordingSession?.segment || !recordingSession.card) return;
  const now = Date.now();
  const segmentOffsetSeconds = Math.max(0, (now - recordingSession.startedAt) / 1000);
  const previousSeconds = (recordingSession.card.segments || []).reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0);
  const highlight = { id:crypto.randomUUID(), at:now, type:'important', segmentOffsetSeconds, offsetSeconds:segmentOffsetSeconds, globalOffsetSeconds:previousSeconds + segmentOffsetSeconds, context:liveUtterances.slice(-2).map(item => item.text).join(' ') };
  recordingSession.segment.highlights ||= [];
  recordingSession.segment.highlights.push(highlight);
  recordingSession.card.highlights ||= [];
  recordingSession.card.highlights.push({ ...highlight, segmentId:recordingSession.segment.id });
  persistWorkspaces();
  showToast('Момент отмечен');
});
document.querySelector('#space-form').addEventListener('submit', event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { spaceDialog.close(); return; }
  createSpace(document.querySelector('#space-name').value);
  spaceDialog.close();
});
document.querySelector('#recording-preflight-form')?.addEventListener('submit', event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { finishRecordingPreflight(false); return; }
  const consent = document.getElementById('recording-participant-consent');
  if (!consent.checked) { consent.reportValidity(); return; }
  const settings = loadAiSettings();
  settings.captureSystemAudio = document.getElementById('recording-system-audio').checked;
  safeJsonStorageSet('sloy.ai-settings', settings);
  safeStorageSet('sloy.recording-preflight.v1', '1');
  finishRecordingPreflight(true);
});
recordingPreflightDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  finishRecordingPreflight(false);
});
document.querySelector('#link-form').addEventListener('submit', event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    editingLinkId = null;
    document.querySelector('#link-dialog').close();
    return;
  }
  const label = document.querySelector('#link-label').value.trim();
  const url = normalizeExternalUrl(document.querySelector('#link-url').value);
  if (!label) { showToast('Добавьте название ссылки'); document.querySelector('#link-label').focus(); return; }
  if (!url) { showToast('Введите обычную http/https ссылку'); document.querySelector('#link-url').focus(); return; }
  const existing = editingLinkId ? cards.find(item => item.id === editingLinkId) : null;
  if (existing?.type === 'links') {
    const current = existing.links?.[0] || {};
    existing.title = label;
    existing.links = [{ ...current, icon:current.icon || '↗', label, url }];
  } else {
    cards.unshift({ id:`card-${Date.now()}`, createdAt:Date.now(), type:'links', size:'small', accent:randomAccent(), kicker:'Ссылка', title:label, links:[{ icon:'↗', label, url }] });
  }
  editingLinkId = null;
  saveCards(existing ? 'Ссылка обновлена' : 'Ссылка добавлена');
  document.querySelector('#link-dialog').close();
  setEditMode(true);
  render();
});
document.querySelector('#image-form').addEventListener('submit', event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { document.querySelector('#image-dialog').close(); return; }
  const card = cards.find(item => item.id === editingImageId);
  if (!card) return;
  const rawLink = document.querySelector('#image-link').value;
  const normalizedLink = rawLink ? normalizeExternalUrl(rawLink) : '';
  if (rawLink && !normalizedLink) { showToast('Введите обычную http/https ссылку'); return; }
  card.title = document.querySelector('#image-title').value.trim() || 'Изображение';
  card.linkUrl = normalizedLink;
  card.imageFit = document.querySelector('#image-fit').value;
  saveCards('Настройки изображения сохранены');
  document.querySelector('#image-dialog').close();
  render();
});
document.querySelector('#workspace-title').addEventListener('blur', event => {
  const title = event.currentTarget.textContent.trim();
  if (!title) { event.currentTarget.textContent = activeSpace().title; return; }
  activeSpace().title = title;
  activeSpace().glyph = title.split(/\s+/).slice(0,2).map(word => word[0]).join('').toLocaleUpperCase('ru');
  saveCards('Название сохранено');
  renderSpaces();
});

imageInput.addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) addImageFile(file, file.name.replace(/\.[^.]+$/, ''));
  imageInput.value = '';
});

document.getElementById('knowledge-toggle')?.addEventListener('click', () => {
  knowledgeHubTab = 'chat';
  renderKnowledgeHub();
  knowledgeDialog.showModal();
  setTimeout(() => spaceChatInput.focus(), 50);
});

document.querySelectorAll('[data-knowledge-tab]').forEach(button => button.addEventListener('click', () => {
  setKnowledgeHubTab(button.dataset.knowledgeTab);
  setTimeout(() => (knowledgeHubTab === 'chat' ? spaceChatInput : knowledgeInput).focus(), 30);
}));
document.getElementById('space-chat-send')?.addEventListener('click', () => void sendSpaceChatMessage());
document.getElementById('space-chat-suggestions')?.addEventListener('click', event => {
  const button = event.target.closest('[data-space-prompt]');
  if (button) void sendSpaceChatMessage(button.dataset.spacePrompt);
});
spaceChatInput?.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendSpaceChatMessage(); }
});

document.getElementById('knowledge-send')?.addEventListener('click', addKnowledgeText);
document.getElementById('knowledge-image')?.addEventListener('click', () => knowledgeImageInput.click());
knowledgeImageInput?.addEventListener('change', event => {
  [...event.target.files].forEach(file => void addKnowledgeImage(file));
  knowledgeImageInput.value = '';
});
knowledgeInput?.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); addKnowledgeText(); }
});
knowledgeInput?.addEventListener('paste', event => {
  const images = [...event.clipboardData.items].filter(item => item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
  if (!images.length) return;
  event.preventDefault();
  images.forEach(file => void addKnowledgeImage(file));
});

document.addEventListener('paste', event => {
  if (document.activeElement.matches('input, textarea, [contenteditable="true"]')) return;
  const imageItem = [...event.clipboardData.items].find(item => item.type.startsWith('image/'));
  if (imageItem) {
    event.preventDefault();
    addImageFile(imageItem.getAsFile());
    return;
  }
  const text = event.clipboardData.getData('text/plain');
  if (text) { event.preventDefault(); addPastedText(text); }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    if (recordingSession || recordingStarting) {
      event.preventDefault();
      requestHide();
      return;
    }
    if (document.getElementById('font-panel') && !document.getElementById('font-panel').hidden) {
      document.getElementById('font-panel').hidden = true;
      return;
    }
    if (!addMenu.hidden) { addMenu.hidden = true; return; }
    if (search.value) { search.value = ''; filterCards(''); search.blur(); return; }
    if (editMode) { setEditMode(false); return; }
    // Hides the app without exiting
    requestHide();
  }
  const nativeUndoTarget = document.activeElement?.closest?.('input,textarea,[contenteditable="true"]');
  const cardUndoShortcut = isCardUndoShortcut(event);
  if (cardUndoShortcut && !nativeUndoTarget && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    const deletedFallback = [...deletedCardHistory].reverse().find(entry => entry.spaceId === activeSpace().id);
    if (!undoLastCardAction() && !(deletedFallback && restoreDeletedCard(deletedFallback))) showToast('В этом пространстве больше нечего отменять');
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); addCard('text'); }
  if (event.key.toLowerCase() === 'e' && !event.ctrlKey && document.activeElement.tagName !== 'INPUT' && !document.activeElement.isContentEditable) setEditMode(!editMode);
});

document.addEventListener('keyup', event => {
  if (event.key === 'Control' || (imageZoomPreview && !event.ctrlKey)) resetImageZoomPreview();
}, true);

window.sloy?.onShown(() => {
  document.body.classList.remove('hiding');
  requestAnimationFrame(() => document.body.classList.add('visible'));
});
window.sloy?.onHiding(() => {
  document.body.classList.add('hiding');
  document.body.classList.remove('visible');
});

// ══════════════════════════════════════════
// ТЕМА — перемикач темна / світла
// ══════════════════════════════════════════
(function initTheme() {
  const saved = safeStorageGet('sloy.theme') || 'dark';
  if (saved === 'light') document.body.classList.add('light-theme');
  updateThemeBtns(saved);
})();

function updateThemeBtns(theme) {
  document.getElementById('theme-dark')?.classList.toggle('active', theme !== 'light');
  document.getElementById('theme-light')?.classList.toggle('active', theme === 'light');
}

document.getElementById('theme-dark')?.addEventListener('click', () => {
  document.body.classList.remove('light-theme');
  safeStorageSet('sloy.theme', 'dark');
  updateThemeBtns('dark');
});
document.getElementById('theme-light')?.addEventListener('click', () => {
  document.body.classList.add('light-theme');
  safeStorageSet('sloy.theme', 'light');
  updateThemeBtns('light');
});

// ══════════════════════════════════════════
// ШРИФТ — вибір і збереження
// ══════════════════════════════════════════
(function initFont() {
  const saved = safeStorageGet('sloy.font') || 'default';
  applyFont(saved);
})();

function applyFont(font) {
  if (font === 'default') {
    document.body.removeAttribute('data-font');
  } else {
    document.body.setAttribute('data-font', font);
  }
  document.querySelectorAll('.font-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === font);
  });
}

document.querySelectorAll('.font-option').forEach(btn => {
  btn.addEventListener('click', () => {
    const font = btn.dataset.font;
    if (savedTextRange && savedEditableElement?.isConnected) {
      const richFont = { default:'Segoe UI', JetBrains:'JetBrains Mono' }[font] || font;
      applyRichCommand('fontName', richFont);
      closeFontPanel();
      showToast('Шрифт применён только к выделенному тексту');
      return;
    }
    applyFont(font);
    safeStorageSet('sloy.font', font);
  });
});

// ══════════════════════════════════════════
// ПАНЕЛЬ Aa — відкрити / закрити
// ══════════════════════════════════════════
// Grok / xAI settings. The API key is stored only in Electron safeStorage.
const aiSettingsDialog = document.getElementById('ai-settings-dialog');
const aiKeyStatus = document.getElementById('ai-key-status');
const aiKeyList = document.getElementById('ai-key-list');
const aiKeyInputs = document.getElementById('ai-key-inputs');
const aiKeyVerificationTimers = new WeakMap();
let aiKeyStatusTimer = null;

function aiKeyInputRowMarkup(removable = false) {
  return `<input class="ai-api-key" type="password" autocomplete="off" placeholder="csk-…, xai-…, AQ.… / AIza… или gsk_…"><button type="button" class="ai-key-input-remove" aria-label="Убрать поле" ${removable ? '' : 'hidden'}>×</button><small class="ai-key-inline-status" aria-live="polite">Ключ будет проверен автоматически</small>`;
}

function aiKeyHealthLabel(status, reason = '') {
  if (status === 'working') return 'Рабочий · проверено сейчас';
  if (status === 'invalid') return 'Нерабочий · провайдер отклонил ключ';
  if (status === 'limited') return 'Ключ распознан, но лимит исчерпан';
  if (status === 'timeout') return 'Проверка не завершилась · провайдер не ответил';
  if (status === 'offline' || reason === 'network') return 'Не удалось проверить · нет соединения';
  if (status === 'unavailable') return 'Провайдер временно недоступен';
  return 'Статус пока неизвестен';
}

function addAiKeyInputField() {
  const row = document.createElement('div');
  row.className = 'ai-key-input-row';
  row.innerHTML = aiKeyInputRowMarkup(true);
  aiKeyInputs.append(row);
  row.querySelector('input').focus();
}

function resetAiKeyInputFields() {
  aiKeyInputs.innerHTML = `<div class="ai-key-input-row">${aiKeyInputRowMarkup()}</div>`;
  aiKeyInputs.querySelector('.ai-api-key').id = 'xai-api-key';
}

function renderAiKeyList(entries = []) {
  aiKeyList.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = `ai-key-list-row status-${entry.status || 'unknown'}`;
    const info = document.createElement('div');
    info.className = 'ai-key-list-info';
    const label = document.createElement('span');
    label.textContent = entry.label || entry.provider || 'AI-ключ';
    const health = document.createElement('small');
    health.textContent = aiKeyHealthLabel(entry.status, entry.reason);
    info.append(label, health);
    row.append(info);
    if (entry.removable) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.aiKeyRemove = entry.id;
      remove.textContent = 'Удалить';
      row.append(remove);
    } else {
      const environment = document.createElement('em');
      environment.textContent = 'из системы';
      row.append(environment);
    }
    aiKeyList.append(row);
  }
}

async function refreshAiKeyStatus() {
  if (!window.sloy?.xaiKeyStatus) { aiKeyStatus.textContent = 'Доступно только в приложении для Windows'; return; }
  aiKeyStatus.textContent = 'Проверяю подключение…';
  try {
    const status = await window.sloy.xaiKeyStatus({ verify:true });
    const anyProvider = Boolean(status?.configured || status?.answerConfigured);
    const workingProvider = Boolean(status?.workingAnswerKeyCount || status?.azureStatus === 'working' || status?.providers?.bluesminds);
    aiKeyStatus.classList.toggle('configured', workingProvider);
    aiKeyStatus.classList.toggle('has-error', anyProvider && !workingProvider);
    const providers = [status?.providers?.azure ? `Azure Speech (${status.azureRegion}) · ${aiKeyHealthLabel(status.azureStatus, status.azureReason)}` : '', status?.providers?.cerebras ? `Cerebras · ключей: ${status.cerebrasKeyCount || 1}` : '', status?.providers?.xai ? `xAI · ключей: ${status.xaiKeyCount || 1}` : '', status?.providers?.gemini ? `Gemini · ключей: ${status.geminiKeyCount || 1}` : '', status?.providers?.groq ? `Groq · ключей: ${status.groqKeyCount || 1}` : '', status?.providers?.bluesminds ? 'Bluesminds · резерв' : ''].filter(Boolean);
    const warnings = [status?.invalidXaiKey ? 'сохранённый xAI-ключ не распознан' : '', anyProvider && !workingProvider ? 'нет подтверждённого рабочего ключа' : ''].filter(Boolean);
    aiKeyStatus.textContent = anyProvider ? `Подключено: ${providers.join(' + ')}${warnings.length ? ` · Внимание: ${warnings.join(', ')}` : ''}` : status?.invalidStoredKey ? 'Сохранённые данные ключа повреждены · сохраните ключ заново' : status?.encryptionAvailable === false ? 'Защищённое хранилище Windows недоступно' : 'AI-провайдер ещё не подключён';
    renderAiKeyList(status?.keyEntries || []);
    if (status?.azureRegion) document.getElementById('azure-speech-region').value = status.azureRegion;
  } catch {
    aiKeyStatus.classList.remove('configured');
    aiKeyStatus.textContent = 'Не удалось проверить подключение · попробуйте ещё раз';
    renderAiKeyList([]);
  }
}

document.getElementById('ai-key-add-field')?.addEventListener('click', addAiKeyInputField);
aiKeyInputs?.addEventListener('input', event => {
  const input = event.target.closest('.ai-api-key');
  if (!input) return;
  const row = input.closest('.ai-key-input-row');
  const status = row.querySelector('.ai-key-inline-status');
  clearTimeout(aiKeyVerificationTimers.get(input));
  row.classList.remove('status-working', 'status-invalid', 'status-limited', 'status-offline');
  const key = input.value.trim();
  if (!key) { status.textContent = 'Ключ будет проверен автоматически'; return; }
  if (!/^(?:(?:gsk_|xai-|csk-)[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})$/.test(key)) { status.textContent = 'Введите ключ целиком'; row.classList.add('status-invalid'); return; }
  status.textContent = 'Проверяю ключ…';
  const timer = setTimeout(async () => {
    try {
      const result = await window.sloy?.verifyXaiKey?.(key);
      if (input.value.trim() !== key) return;
      const health = result?.status || (result?.ok ? 'working' : 'invalid');
      row.classList.add(`status-${health}`);
      status.textContent = aiKeyHealthLabel(health, result?.reason);
    } catch {
      if (input.value.trim() !== key) return;
      row.classList.add('status-offline');
      status.textContent = 'Не удалось проверить · нет соединения';
    }
  }, 650);
  aiKeyVerificationTimers.set(input, timer);
});
aiKeyInputs?.addEventListener('click', event => {
  const remove = event.target.closest('.ai-key-input-remove');
  if (remove && !remove.hidden) remove.closest('.ai-key-input-row')?.remove();
});
aiKeyList?.addEventListener('click', async event => {
  const button = event.target.closest('[data-ai-key-remove]');
  if (!button) return;
  button.disabled = true;
  try {
    const result = await window.sloy?.removeXaiKey(button.dataset.aiKeyRemove);
    if (!result?.ok) throw new Error(result?.reason || 'remove_failed');
    await refreshAiKeyStatus();
    showToast('Ключ удалён');
  } catch {
    button.disabled = false;
    showToast('Не удалось удалить этот ключ');
  }
});

document.getElementById('ai-settings-toggle')?.addEventListener('click', () => {
  const settings = loadAiSettings();
  document.getElementById('capture-system-audio').checked = settings.captureSystemAudio;
  document.getElementById('xai-auto-transcribe').checked = settings.autoTranscribe;
  document.getElementById('xai-live-transcription').checked = settings.liveTranscription;
  document.getElementById('xai-live-suggestions').checked = settings.liveSuggestions;
  document.getElementById('xai-internet-search').checked = settings.internetSearch;
  document.getElementById('xai-auto-structure').checked = settings.autoStructure;
  document.getElementById('transcription-language').value = settings.transcriptionLanguage || 'auto';
  resetAiKeyInputFields();
  document.getElementById('azure-speech-key').value = '';
  if (!aiSettingsDialog.open) aiSettingsDialog.showModal();
  void refreshAiKeyStatus();
  clearInterval(aiKeyStatusTimer);
  aiKeyStatusTimer = setInterval(() => { if (aiSettingsDialog.open) void refreshAiKeyStatus(); }, 120000);
});
aiSettingsDialog?.addEventListener('close', () => {
  clearInterval(aiKeyStatusTimer);
  aiKeyStatusTimer = null;
});

document.getElementById('ai-settings-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { aiSettingsDialog.close(); return; }
  const submitter = event.submitter;
  submitter.disabled = true;
  aiSettingsDialog.setAttribute('aria-busy', 'true');
  try {
    const settings = {
      captureSystemAudio:document.getElementById('capture-system-audio').checked,
      autoTranscribe:document.getElementById('xai-auto-transcribe').checked,
      liveTranscription:document.getElementById('xai-live-transcription').checked,
      liveSuggestions:document.getElementById('xai-live-suggestions').checked,
      internetSearch:document.getElementById('xai-internet-search').checked,
      autoStructure:document.getElementById('xai-auto-structure').checked,
      transcriptionLanguage:document.getElementById('transcription-language').value
    };
    safeJsonStorageSet('sloy.ai-settings', settings);
    const azureKey = document.getElementById('azure-speech-key').value.trim();
    const azureRegion = document.getElementById('azure-speech-region').value.trim();
    if (azureKey) {
      const result = await window.sloy?.setAzureSpeechKey({ key:azureKey, region:azureRegion });
      if (!result?.ok) {
        const message = result?.reason === 'encryption' ? 'Защищённое хранилище недоступно' : result?.reason === 'invalid_format' ? 'Проверьте KEY 1 и регион Azure' : result?.reason === 'http_401' || result?.reason === 'http_403' ? 'Azure отклонил ключ или регион не совпадает' : result?.reason === 'http_429' ? 'Бесплатный лимит Azure исчерпан' : result?.reason === 'network' ? 'Не удалось связаться с Azure' : `Azure Speech: ${result?.reason || 'ошибка'}`;
        showToast(message);
        return;
      }
    }
    const keys = [...document.querySelectorAll('.ai-api-key')].map(input => input.value.trim()).filter(Boolean);
    for (const key of keys) {
      const result = await window.sloy?.setXaiKey(key);
      if (!result?.ok) {
        const message = result?.reason === 'encryption' ? 'Защищённое хранилище недоступно' : result?.reason === 'invalid_format' ? 'Нужен чистый ключ Cerebras, xAI, Gemini или Groq' : result?.reason === 'http_401' || result?.reason === 'http_403' ? 'Провайдер отклонил ключ' : result?.reason === 'http_429' ? 'Лимит провайдера исчерпан' : result?.reason === 'network' ? 'Не удалось проверить ключ — проверьте интернет' : 'Проверьте API-ключ';
        showToast(message);
        return;
      }
    }
    resetAiKeyInputFields();
    document.getElementById('azure-speech-key').value = '';
    aiSettingsDialog.close();
    showToast('Настройки AI сохранены');
  } catch {
    showToast('Не удалось сохранить настройки AI · попробуйте ещё раз');
  } finally {
    submitter.disabled = false;
    aiSettingsDialog.removeAttribute('aria-busy');
  }
});

document.getElementById('xai-key-clear')?.addEventListener('click', async () => {
  try {
    await window.sloy?.clearXaiKey();
    resetAiKeyInputFields();
    await refreshAiKeyStatus();
    showToast('API-ключ удалён');
  } catch { showToast('Не удалось удалить API-ключ'); }
});

document.getElementById('azure-key-clear')?.addEventListener('click', async () => {
  try {
    await window.sloy?.clearAzureSpeechKey();
    document.getElementById('azure-speech-key').value = '';
    await refreshAiKeyStatus();
    showToast('Ключ Azure Speech удалён');
  } catch { showToast('Не удалось удалить ключ Azure Speech'); }
});

const fontPanel = document.getElementById('font-panel');

function closeFontPanel() { fontPanel.hidden = true; }

// Context toolbar for formatting selected text inside editable cards.
const richTextToolbar = document.getElementById('rich-text-toolbar');
let savedTextRange = null;
let savedEditableElement = null;

function clearRememberedTextSelection() {
  savedTextRange = null;
  savedEditableElement = null;
  richTextToolbar.hidden = true;
}

function rememberTextSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    if (!richTextToolbar.matches(':focus-within')) clearRememberedTextSelection();
    return;
  }
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
  const editable = node?.closest?.('[contenteditable="true"]');
  if (richTextToolbar.contains(node)) return;
  if (!editable) { clearRememberedTextSelection(); return; }
  savedTextRange = range.cloneRange();
  savedEditableElement = editable;
  const rect = range.getBoundingClientRect();
  richTextToolbar.hidden = false;
  const width = richTextToolbar.offsetWidth || 620;
  richTextToolbar.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
  richTextToolbar.style.top = `${Math.max(8, rect.top - 44)}px`;
}

function applyRichCommand(command, value = null) {
  if (!savedTextRange || !savedEditableElement) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedTextRange);
  document.execCommand(command, false, value);
  savedEditableElement.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'formatBold' }));
  rememberTextSelection();
}

document.addEventListener('selectionchange', () => requestAnimationFrame(rememberTextSelection));
document.addEventListener('pointerdown', event => {
  if (!richTextToolbar.contains(event.target) && !fontPanel.contains(event.target) && event.target.id !== 'font-toggle' && !event.target.closest('[contenteditable="true"]')) clearRememberedTextSelection();
});
richTextToolbar.querySelectorAll('button[data-rich-command]').forEach(button => {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => applyRichCommand(button.dataset.richCommand));
});
richTextToolbar.querySelector('[data-rich-block]')?.addEventListener('click', event => {
  event.preventDefault();
  applyRichCommand('formatBlock', event.currentTarget.dataset.richBlock);
});
document.getElementById('rich-font-name')?.addEventListener('change', event => applyRichCommand('fontName', event.target.value.trim()));
document.getElementById('rich-font-size')?.addEventListener('change', event => applyRichCommand('fontSize', event.target.value));
document.getElementById('rich-text-color')?.addEventListener('input', event => applyRichCommand('foreColor', event.target.value));
document.getElementById('rich-highlight-color')?.addEventListener('input', event => applyRichCommand('hiliteColor', event.target.value));
document.getElementById('rich-emoji')?.addEventListener('change', event => {
  if (event.target.value) applyRichCommand('insertText', event.target.value);
  event.target.value = '';
});

document.getElementById('font-toggle')?.addEventListener('click', event => {
  event.stopPropagation();
  fontPanel.hidden = !fontPanel.hidden;
});
document.getElementById('font-panel-close')?.addEventListener('click', event => {
  event.stopPropagation();
  closeFontPanel();
});
document.addEventListener('click', event => {
  if (fontPanel.hidden) return;
  if (!fontPanel.contains(event.target) && event.target.id !== 'font-toggle') {
    closeFontPanel();
  }
});

// ══════════════════════════════════════════
// РЕЗАЙЗ САЙДБАРА — тягни для зміни ширини
// ══════════════════════════════════════════
(function initRailResize() {
  const MIN_WIDTH = 64;
  const maxWidth = () => Math.min(520, Math.round(window.innerWidth * 0.45));
  const DEFAULT_WIDTH = 215;
  const stored = parseInt(safeStorageGet('sloy.rail-width'));
  let preferredWidth = (stored >= MIN_WIDTH && stored <= 520) ? stored : DEFAULT_WIDTH;
  const handle = document.getElementById('rail-resize');
  if (!handle) return;
  const applyWidth = (width, persist = false) => {
    const next = Math.max(MIN_WIDTH, Math.min(maxWidth(), Math.round(width)));
    document.documentElement.style.setProperty('--rail-width', next + 'px');
    document.body.dataset.railMode = next < 112 ? 'compact' : next < 180 ? 'narrow' : 'expanded';
    handle.setAttribute('aria-valuenow', String(next));
    handle.setAttribute('aria-valuemax', String(maxWidth()));
    if (persist) safeStorageSet('sloy.rail-width', next);
    return next;
  };
  applyWidth(preferredWidth);

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-width')) || preferredWidth;
    handle.classList.add('dragging');
    document.body.classList.add('rail-resizing');
    handle.setPointerCapture(event.pointerId);

    const onMove = e => {
      applyWidth(startWidth + (e.clientX - startX));
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('rail-resizing');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      const finalWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-width'));
      preferredWidth = finalWidth;
      applyWidth(finalWidth, true);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
  handle.addEventListener('dblclick', () => {
    preferredWidth = DEFAULT_WIDTH;
    applyWidth(DEFAULT_WIDTH, true);
    showToast('Ширина боковой панели сброшена');
  });
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-width')) || DEFAULT_WIDTH;
    const step = event.shiftKey ? 32 : 10;
    const next = event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maxWidth() : current + (event.key === 'ArrowRight' ? step : -step);
    preferredWidth = next;
    applyWidth(next, true);
  });
  window.addEventListener('resize', () => applyWidth(preferredWidth));
})();

window.addEventListener('blur', () => {
  resetImageZoomPreview();
  flushDebouncedSave();
});
window.addEventListener('beforeunload', () => flushDebouncedSave(''));

render();
document.body.dataset.appReady = 'true';
requestAnimationFrame(() => document.body.classList.add('visible'));
