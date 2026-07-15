const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const os = require('node:os');
const {
  UpdateManager,
  classifyUpdateError,
  downloadOverallProgress,
  filePlanFromInfo
} = require('../update-manager');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class FakeWebContents extends EventEmitter {
  constructor() { super(); this.messages = []; }
  setWindowOpenHandler() {}
  isLoading() { return false; }
  send(channel, payload) { this.messages.push({ channel, payload }); }
}

class FakeWindow extends EventEmitter {
  constructor() { super(); this.webContents = new FakeWebContents(); this.destroyed = false; this.visible = false; }
  async loadFile() { this.webContents.emit('did-finish-load'); }
  isDestroyed() { return this.destroyed; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() {}
  setProgressBar() {}
  destroy() { this.destroyed = true; this.emit('closed'); }
}

class FakeIpc {
  constructor() { this.handlers = new Map(); this.listeners = new Map(); }
  handle(name, handler) { this.handlers.set(name, handler); }
  on(name, handler) { this.listeners.set(name, handler); }
}

class SuccessfulUpdater extends EventEmitter {
  async checkForUpdates() {
    this.emit('checking-for-update');
    this.emit('update-available', { version:'0.2.0', files:[{ url:'V-Setup-0.2.0-x64.exe', size:4096, sha512:'hash' }] });
  }
  async downloadUpdate() {
    this.emit('download-progress', { transferred:2048, total:4096, bytesPerSecond:1024, percent:50 });
    this.emit('download-progress', { transferred:4096, total:4096, bytesPerSecond:2048, percent:100 });
    this.emit('update-downloaded', { version:'0.2.0', downloadedFile:'temporary/V-Setup.exe' });
  }
  quitAndInstall() { this.installed = true; }
}

function createManager(autoUpdater, enabled = true) {
  const app = {
    getVersion:() => '0.1.0',
    getPath:name => name === 'temp' ? os.tmpdir() : path.join(os.tmpdir(), 'v-updater-tests')
  };
  return new UpdateManager({
    app, autoUpdater, BrowserWindow:FakeWindow, ipcMain:new FakeIpc(), shell:{ openPath:async () => '' },
    iconPath:'icon.png', preloadPath:'update-preload.js', htmlPath:'updater.html',
    logFilePath:path.join(os.tmpdir(), 'v-updater-tests', `${Date.now()}-${Math.random()}.log`), enabled
  }).initialize();
}

test('manifest files and known sizes are exposed honestly', () => {
  const files = filePlanFromInfo({ files:[{ url:'https://host/V%20Setup.exe', size:120, sha512:'x' }] });
  assert.deepEqual(files, [{ name:'V Setup.exe', size:120, sha512:true }]);
  assert.equal(downloadOverallProgress({ transferred:50, total:100, percent:50 }), 53.5);
  assert.equal(downloadOverallProgress({ transferred:50, total:0 }, 0, 1), 18);
});

test('successful update goes through download, verification and restart', async () => {
  const updater = new SuccessfulUpdater();
  const manager = createManager(updater);
  await manager.check({ manual:false });
  await wait(1200);
  assert.equal(manager.state.stage, 'ready');
  assert.equal(manager.state.progress, 96);
  assert.equal(manager.state.filesCompleted, 1);
  assert.equal(manager.state.filesTotal, 1);
  assert.equal(manager.state.canInstall, true);
  await manager.install();
  await wait(650);
  assert.equal(updater.installed, true);
  assert.equal(manager.state.stage, 'restarting');
  manager.dispose();
});

test('network failure is friendly and retryable', async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { const error = new Error('getaddrinfo ENOTFOUND github.com'); error.code = 'ENOTFOUND'; throw error; };
  const manager = createManager(updater);
  const result = await manager.check({ manual:false });
  assert.equal(result.ok, false);
  assert.equal(manager.state.stage, 'error');
  assert.equal(manager.state.errorCode, 'network');
  assert.equal(manager.state.canRetry, true);
  manager.dispose();
});

test('main updater failures have distinct user-facing categories', () => {
  assert.equal(classifyUpdateError(Object.assign(new Error('full'), { code:'ENOSPC' })).code, 'disk_space');
  assert.equal(classifyUpdateError(Object.assign(new Error('denied'), { code:'EACCES' })).code, 'permission');
  assert.equal(classifyUpdateError(new Error('sha512 checksum mismatch')).code, 'integrity');
  assert.equal(classifyUpdateError(new Error('HTTP 404')).code, 'not_found');
  assert.equal(classifyUpdateError(new Error('HTTP 503')).code, 'server');
  assert.equal(classifyUpdateError(new Error('NSIS install failed'), 'installing').code, 'install');
});
