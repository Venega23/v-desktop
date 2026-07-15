const elements = Object.freeze({
  close:document.getElementById('update-close'),
  badge:document.getElementById('update-badge'),
  title:document.getElementById('update-title'),
  description:document.getElementById('update-description'),
  percent:document.getElementById('update-percent'),
  progress:document.getElementById('update-progress'),
  fill:document.getElementById('update-progress-fill'),
  files:document.getElementById('update-files'),
  currentFile:document.getElementById('update-current-file'),
  size:document.getElementById('update-size'),
  speed:document.getElementById('update-speed'),
  eta:document.getElementById('update-eta'),
  version:document.getElementById('update-version'),
  retry:document.getElementById('update-retry'),
  install:document.getElementById('update-install'),
  log:document.getElementById('update-log'),
  steps:[...document.querySelectorAll('[data-update-step]')]
});

const STAGES = ['checking','files','downloading','verifying','ready','installing','restarting','completed'];

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б','КБ','МБ','ГБ'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / 1024 ** index;
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits:index ? 1 : 0 })} ${units[index]}`;
}

function formatEta(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return 'Уточняется';
  const value = Math.ceil(Number(seconds));
  if (value < 60) return `около ${Math.max(1, value)} сек.`;
  if (value < 3600) return `около ${Math.ceil(value / 60)} мин.`;
  return `около ${Math.ceil(value / 3600)} ч.`;
}

function stepIndex(stage) {
  if (stage === 'completed') return 7;
  if (stage === 'ready') return 4;
  return Math.max(0, STAGES.indexOf(stage));
}

function render(state = {}) {
  const progress = Math.max(0, Math.min(100, Number(state.progress) || 0));
  document.body.dataset.stage = state.stage || 'idle';
  elements.badge.textContent = state.stage === 'error' ? 'ТРЕБУЕТ ВНИМАНИЯ' : state.stage === 'completed' ? 'ГОТОВО' : 'ОБНОВЛЕНИЕ';
  elements.title.textContent = state.title || 'Обновление V';
  elements.description.textContent = state.description || '';
  elements.percent.textContent = `${Math.round(progress)}%`;
  elements.fill.style.width = `${progress}%`;
  elements.progress.setAttribute('aria-valuenow', String(Math.round(progress)));
  const totalFiles = Number(state.filesTotal) || 0;
  elements.files.textContent = totalFiles ? `${Number(state.filesCompleted) || 0} из ${totalFiles}` : 'Уточняется';
  elements.currentFile.textContent = state.currentFile || '—';
  elements.size.textContent = state.totalKnown
    ? `${formatBytes(state.transferred)} из ${formatBytes(state.total)}`
    : state.transferred ? `${formatBytes(state.transferred)} · общий размер уточняется` : 'Уточняется';
  elements.speed.textContent = state.bytesPerSecond ? `${formatBytes(state.bytesPerSecond)}/с` : '—';
  elements.eta.textContent = state.stage === 'downloading' ? formatEta(state.etaSeconds) : state.stage === 'ready' ? 'Готово' : '—';
  elements.version.textContent = state.targetVersion
    ? `V ${state.installedVersion || '—'}  →  V ${state.targetVersion}`
    : `Текущая версия: V ${state.installedVersion || '—'}`;
  elements.retry.hidden = !state.canRetry;
  elements.install.hidden = !state.canInstall;
  elements.log.hidden = state.stage !== 'error';
  const activeIndex = stepIndex(state.stage);
  elements.steps.forEach((item, index) => {
    item.classList.toggle('done', state.stage !== 'error' && index < activeIndex);
    item.classList.toggle('active', state.stage === 'error' ? index === Math.max(0, activeIndex) : index === activeIndex);
  });
}

function queueRender(state) {
  if (state) render(state);
}

elements.close.addEventListener('click', () => window.vUpdater.close());
elements.retry.addEventListener('click', () => { elements.retry.disabled = true; window.vUpdater.retry().finally(() => { elements.retry.disabled = false; }); });
elements.install.addEventListener('click', () => { elements.install.disabled = true; window.vUpdater.install().finally(() => { elements.install.disabled = false; }); });
elements.log.addEventListener('click', () => window.vUpdater.openLog());

window.vUpdater.onState(queueRender);
window.vUpdater.getState().then(queueRender);
