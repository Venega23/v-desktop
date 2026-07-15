const path = require('node:path');
const fs = require('node:fs/promises');

const STAGE_PROGRESS = Object.freeze({
  idle:0,
  checking:4,
  files:14,
  downloading:18,
  verifying:90,
  ready:96,
  installing:99,
  restarting:100,
  completed:100,
  error:0
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function remoteFileName(value) {
  const raw = String(value || '').split(/[?#]/, 1)[0];
  try { return decodeURIComponent(raw.split('/').pop() || 'Обновление V'); }
  catch { return raw.split('/').pop() || 'Обновление V'; }
}

function filePlanFromInfo(info = {}) {
  const source = Array.isArray(info.files) && info.files.length ? info.files : [{ url:info.path || '' }];
  return source.map((file, index) => ({
    name:remoteFileName(file?.url || file?.path || info.path || `Файл ${index + 1}`),
    size:finiteNumber(file?.size),
    sha512:Boolean(file?.sha512)
  }));
}

function downloadOverallProgress(progress = {}, filesCompleted = 0, filesTotal = 1) {
  const percent = finiteNumber(progress.percent, -1);
  const transferred = finiteNumber(progress.transferred);
  const total = finiteNumber(progress.total);
  let downloadPercent = percent >= 0 ? percent : total > 0 ? transferred / total * 100 : -1;
  if (downloadPercent < 0 && filesTotal > 0) downloadPercent = filesCompleted / filesTotal * 100;
  return Math.min(89, Math.max(STAGE_PROGRESS.downloading, 18 + Math.min(100, downloadPercent) * .71));
}

function classifyUpdateError(error, stage = '') {
  const source = `${error?.code || ''} ${error?.statusCode || ''} ${error?.message || error || ''}`.toLowerCase();
  if (/enospc|not enough (?:free )?space|disk (?:is )?full|insufficient.*space/.test(source)) {
    return { code:'disk_space', title:'Недостаточно места', message:'Освободите место на диске и повторите попытку.', retry:true };
  }
  if (/eacces|eperm|access.*denied|permission|operation not permitted/.test(source)) {
    return { code:'permission', title:'Нет прав на запись', message:'Закройте другие копии V или запустите приложение с правами, позволяющими установить обновление.', retry:true };
  }
  if (/sha-?512|checksum|hash mismatch|signature|integrity|corrupt|неверн.*хеш|поврежд/.test(source)) {
    return { code:'integrity', title:'Файл обновления повреждён', message:'Проверка безопасности не пройдена. Повторите скачивание; текущая версия не изменена.', retry:true };
  }
  if (/\b404\b|not found|enoent/.test(source)) {
    return { code:'not_found', title:'Файл обновления не найден', message:'Релиз опубликован не полностью. Попробуйте ещё раз немного позже.', retry:true };
  }
  if (/\b50[0-9]\b|\b52[0-9]\b|server unavailable|bad gateway|service unavailable/.test(source)) {
    return { code:'server', title:'Сервер обновлений временно недоступен', message:'GitHub сейчас не отвечает. Установленная версия продолжит работать.', retry:true };
  }
  if (/enotfound|eai_again|econnrefused|econnreset|etimedout|timeout|network|internet|offline|socket hang up/.test(source)) {
    return { code:'network', title:'Нет соединения с интернетом', message:'Проверьте подключение и повторите попытку.', retry:true };
  }
  if (stage === 'installing' || /install|nsis|elevat/.test(source)) {
    return { code:'install', title:'Не удалось установить обновление', message:'Текущая версия не повреждена. Закройте другие копии V и повторите попытку.', retry:true };
  }
  return { code:'unknown', title:'Не удалось обновить V', message:'Текущая версия не изменена. Повторите попытку или откройте журнал обновления.', retry:true };
}

class UpdateLog {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  write(level, ...values) {
    const detail = values.map(value => value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    const line = `${new Date().toISOString()} [${level}] ${detail}\n`;
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive:true });
      await fs.appendFile(this.filePath, line, 'utf8');
    }).catch(() => {});
    if (level === 'ERROR') console.error('[updater]', detail);
    else if (level === 'WARN') console.warn('[updater]', detail);
  }

  info(...values) { this.write('INFO', ...values); }
  warn(...values) { this.write('WARN', ...values); }
  error(...values) { this.write('ERROR', ...values); }
  debug(...values) { this.write('DEBUG', ...values); }
}

class UpdateManager {
  constructor({ app, autoUpdater, BrowserWindow, ipcMain, shell, iconPath, preloadPath, htmlPath, logFilePath, enabled = true }) {
    this.app = app;
    this.autoUpdater = autoUpdater;
    this.BrowserWindow = BrowserWindow;
    this.ipcMain = ipcMain;
    this.shell = shell;
    this.iconPath = iconPath;
    this.preloadPath = preloadPath;
    this.htmlPath = htmlPath;
    this.enabled = Boolean(enabled);
    this.log = new UpdateLog(logFilePath);
    this.window = null;
    this.currentInfo = null;
    this.files = [];
    this.manual = false;
    this.downloadPending = false;
    this.backgroundTimer = null;
    this.progressTimer = null;
    this.lastProgressSentAt = 0;
    this.lastErrorAt = 0;
    this.state = {
      stage:'idle', progress:0, title:'Обновление V', description:'Подготовка к проверке обновлений.',
      installedVersion:app.getVersion(), targetVersion:'', filesCompleted:0, filesTotal:0,
      currentFile:'', transferred:0, total:0, bytesPerSecond:0, etaSeconds:null,
      totalKnown:false, canRetry:false, canInstall:false, errorCode:'', logFilePath
    };
  }

  initialize() {
    this.registerIpc();
    if (!this.enabled) return this;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.autoUpdater.allowPrerelease = false;
    this.autoUpdater.logger = {
      info:(...args) => this.log.info(...args),
      warn:(...args) => this.log.warn(...args),
      error:(...args) => this.log.error(...args),
      debug:(...args) => this.log.debug(...args)
    };
    this.bindUpdaterEvents();
    return this;
  }

  registerIpc() {
    this.ipcMain.handle('updater:get-state', event => this.isTrusted(event) ? this.state : null);
    this.ipcMain.handle('updater:retry', event => this.isTrusted(event) ? this.check({ manual:true, force:true }) : null);
    this.ipcMain.handle('updater:install', event => this.isTrusted(event) ? this.install() : null);
    this.ipcMain.handle('updater:open-log', event => this.isTrusted(event) ? this.shell.openPath(this.state.logFilePath) : null);
    this.ipcMain.on('updater:close', event => { if (this.isTrusted(event)) this.window?.hide(); });
  }

  isTrusted(event) {
    return Boolean(this.window && !this.window.isDestroyed() && event?.sender === this.window.webContents);
  }

  bindUpdaterEvents() {
    this.autoUpdater.on('checking-for-update', () => {
      this.setState({ stage:'checking', progress:STAGE_PROGRESS.checking, title:'Проверяем обновления', description:'Связываемся с GitHub Releases и сравниваем версии.' }, true);
    });
    this.autoUpdater.on('update-available', info => { void this.onUpdateAvailable(info); });
    this.autoUpdater.on('update-not-available', info => {
      this.currentInfo = info || null;
      this.setState({
        stage:'completed', progress:100, title:'Установлена последняя версия',
        description:`V ${this.app.getVersion()} уже актуальна.`, targetVersion:this.app.getVersion(),
        filesCompleted:0, filesTotal:0, currentFile:'', transferred:0, total:0,
        bytesPerSecond:0, etaSeconds:null, totalKnown:false, canRetry:false, canInstall:false, errorCode:''
      }, true);
      if (!this.manual) this.window?.hide();
    });
    this.autoUpdater.on('download-progress', progress => this.onDownloadProgress(progress));
    this.autoUpdater.on('update-downloaded', info => this.onUpdateDownloaded(info));
    this.autoUpdater.on('error', error => this.fail(error));
  }

  async createWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.window = new this.BrowserWindow({
      show:false, width:720, height:650, minWidth:520, minHeight:540,
      frame:false, transparent:false, backgroundColor:'#11131a', resizable:true,
      maximizable:false, fullscreenable:false, title:'Обновление V', icon:this.iconPath,
      webPreferences:{ preload:this.preloadPath, contextIsolation:true, nodeIntegration:false, sandbox:true }
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.window.webContents.on('did-finish-load', () => this.sendState(true));
    this.window.on('close', event => {
      if (!this.app.isQuiting) { event.preventDefault(); this.window.hide(); }
    });
    this.window.on('closed', () => { this.window = null; });
    await this.window.loadFile(this.htmlPath);
    return this.window;
  }

  async show() {
    const window = await this.createWindow();
    window.show();
    window.focus();
    this.sendState(true);
    setTimeout(() => this.sendState(true), 0);
  }

  async check({ manual = false, force = false } = {}) {
    this.manual = Boolean(manual);
    if (manual) await this.show();
    if (!this.enabled) {
      this.setState({
        stage:'completed', progress:100, title:'Проверка доступна после установки',
        description:'Автообновление работает в собранной версии V. В режиме разработки оно отключено.',
        canRetry:false, canInstall:false, errorCode:''
      }, true);
      return { ok:false, reason:'not_packaged' };
    }
    if (!force && ['checking','files','downloading','verifying','installing','restarting'].includes(this.state.stage)) {
      if (manual) await this.show();
      return { ok:true, active:true };
    }
    this.currentInfo = null;
    this.files = [];
    this.downloadPending = false;
    this.setState({
      stage:'checking', progress:STAGE_PROGRESS.checking, title:'Проверяем обновления',
      description:'Связываемся с GitHub Releases и сравниваем версии.', targetVersion:'',
      filesCompleted:0, filesTotal:0, currentFile:'', transferred:0, total:0,
      bytesPerSecond:0, etaSeconds:null, totalKnown:false, canRetry:false, canInstall:false, errorCode:''
    }, true);
    this.log.info(`Checking for updates. Current version: ${this.app.getVersion()}`);
    try {
      await this.autoUpdater.checkForUpdates();
      return { ok:true };
    } catch (error) {
      this.fail(error);
      return { ok:false, reason:classifyUpdateError(error).code };
    }
  }

  async onUpdateAvailable(info = {}) {
    this.currentInfo = info;
    this.files = filePlanFromInfo(info);
    const total = this.files.reduce((sum, file) => sum + file.size, 0);
    const totalKnown = this.files.length > 0 && this.files.every(file => file.size > 0);
    if (!this.manual) await this.show();
    this.setState({
      stage:'files', progress:STAGE_PROGRESS.files, title:`Доступна V ${info.version || ''}`.trim(),
      description:'Получаем список файлов и готовим безопасную временную папку.', targetVersion:String(info.version || ''),
      filesCompleted:0, filesTotal:this.files.length, currentFile:this.files[0]?.name || '',
      transferred:0, total:totalKnown ? total : 0, totalKnown, bytesPerSecond:0, etaSeconds:null,
      canRetry:false, canInstall:false, errorCode:''
    }, true);
    try {
      await this.ensureDiskSpace(totalKnown ? total : 0);
    } catch (error) {
      this.fail(error);
      return;
    }
    if (this.downloadPending) return;
    this.downloadPending = true;
    setTimeout(() => { void this.download(); }, 450);
  }

  async ensureDiskSpace(downloadBytes) {
    if (!downloadBytes || typeof fs.statfs !== 'function') return;
    try {
      const stats = await fs.statfs(this.app.getPath('temp'));
      const available = Number(stats.bavail) * Number(stats.bsize);
      const required = downloadBytes * 1.35 + 200 * 1024 * 1024;
      if (Number.isFinite(available) && available < required) {
        const error = new Error(`ENOSPC: ${available} bytes available, ${required} required`);
        error.code = 'ENOSPC';
        throw error;
      }
    } catch (error) {
      if (error?.code === 'ENOSPC') throw error;
      this.log.warn('Free space check was unavailable', error);
    }
  }

  async download() {
    if (!this.currentInfo || this.state.stage === 'error') return;
    this.setState({
      stage:'downloading', progress:STAGE_PROGRESS.downloading, title:'Скачиваем обновление',
      description:'Файл сохраняется во временный кэш. Рабочая версия приложения не изменяется.'
    }, true);
    try { await this.autoUpdater.downloadUpdate(); }
    catch (error) { this.fail(error); }
  }

  onDownloadProgress(progress = {}) {
    const transferred = finiteNumber(progress.transferred);
    const total = finiteNumber(progress.total, this.state.total);
    const speed = finiteNumber(progress.bytesPerSecond);
    const etaSeconds = total > transferred && speed > 0 ? Math.ceil((total - transferred) / speed) : null;
    this.setState({
      stage:'downloading', progress:downloadOverallProgress(progress, 0, this.files.length || 1),
      title:'Скачиваем обновление', description:total > 0
        ? 'Загрузка идёт в безопасную временную папку. Можно продолжать пользоваться V.'
        : 'Сервер не сообщил общий размер. Прогресс показывается по текущему этапу без выдуманных значений.',
      filesCompleted:0, filesTotal:this.files.length || 1, currentFile:this.files[0]?.name || '',
      transferred, total, totalKnown:total > 0, bytesPerSecond:speed, etaSeconds
    });
  }

  onUpdateDownloaded(info = {}) {
    const total = finiteNumber(this.state.total);
    this.setState({
      stage:'verifying', progress:STAGE_PROGRESS.verifying, title:'Проверяем скачанные файлы',
      description:'SHA‑512 и целостность подтверждены. Завершаем подготовку установщика.',
      filesCompleted:this.files.length || 1, filesTotal:this.files.length || 1,
      transferred:total || finiteNumber(this.state.transferred), bytesPerSecond:0, etaSeconds:0,
      canRetry:false, canInstall:false, errorCode:''
    }, true);
    this.log.info(`Update ${info.version || this.currentInfo?.version || ''} downloaded and verified`, info.downloadedFile || '');
    setTimeout(() => {
      if (this.state.stage !== 'verifying') return;
      this.setState({
        stage:'ready', progress:STAGE_PROGRESS.ready, title:'Обновление готово',
        description:'Нажмите кнопку ниже. V безопасно закроется, установит обновление и запустится снова.',
        canInstall:true, canRetry:false
      }, true);
    }, 650);
  }

  async install() {
    if (this.state.stage !== 'ready' || !this.state.canInstall) return { ok:false };
    this.setState({
      stage:'installing', progress:STAGE_PROGRESS.installing, title:'Устанавливаем обновление',
      description:'Закрываем V и передаём проверенный файл установщику Windows.', canInstall:false, canRetry:false
    }, true);
    setTimeout(() => {
      try {
        this.setState({ stage:'restarting', progress:100, title:'Перезапускаем V', description:'Установка продолжится автоматически.' }, true);
        this.autoUpdater.quitAndInstall(false, true);
      } catch (error) { this.fail(error, 'installing'); }
    }, 500);
    return { ok:true };
  }

  fail(error, stage = this.state.stage) {
    const now = Date.now();
    if (now - this.lastErrorAt < 150 && this.state.stage === 'error') return;
    this.lastErrorAt = now;
    const friendly = classifyUpdateError(error, stage);
    this.log.error(`Update failed at stage ${stage}`, error);
    this.setState({
      stage:'error', progress:Math.max(0, Math.min(100, finiteNumber(this.state.progress))),
      title:friendly.title, description:friendly.message, errorCode:friendly.code,
      canRetry:friendly.retry, canInstall:false, bytesPerSecond:0, etaSeconds:null
    }, true);
    if (this.manual) void this.show();
  }

  setState(patch, immediate = false) {
    this.state = { ...this.state, ...patch };
    this.state.progress = Math.round(Math.max(0, Math.min(100, finiteNumber(this.state.progress))) * 10) / 10;
    if (this.window && !this.window.isDestroyed()) {
      const mode = this.state.stage === 'error' ? { mode:'error' } : { mode:'normal' };
      this.window.setProgressBar(this.state.stage === 'idle' || this.state.stage === 'completed' ? -1 : this.state.progress / 100, mode);
    }
    this.sendState(immediate);
  }

  sendState(immediate = false) {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isLoading()) return;
    const now = Date.now();
    const delay = Math.max(0, 160 - (now - this.lastProgressSentAt));
    if (!immediate && delay > 0) {
      if (!this.progressTimer) this.progressTimer = setTimeout(() => {
        this.progressTimer = null;
        this.sendState(true);
      }, delay);
      return;
    }
    if (this.progressTimer) { clearTimeout(this.progressTimer); this.progressTimer = null; }
    this.lastProgressSentAt = now;
    this.window.webContents.send('updater:state', this.state);
  }

  startBackgroundChecks({ initialDelayMs = 12000, intervalMs = 4 * 60 * 60 * 1000 } = {}) {
    if (!this.enabled) return;
    const first = setTimeout(() => { void this.check({ manual:false }); }, initialDelayMs);
    first.unref?.();
    this.backgroundTimer = setInterval(() => { void this.check({ manual:false }); }, intervalMs);
    this.backgroundTimer.unref?.();
  }

  dispose() {
    if (this.backgroundTimer) clearInterval(this.backgroundTimer);
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.backgroundTimer = null;
    this.progressTimer = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}

module.exports = {
  UpdateManager,
  classifyUpdateError,
  downloadOverallProgress,
  filePlanFromInfo,
  remoteFileName,
  STAGE_PROGRESS
};
