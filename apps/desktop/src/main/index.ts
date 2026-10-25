import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type NativeImage,
} from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  getConfig,
  getServerUrl,
  isSafeExternalUrl,
  loadConfig,
  saveConfig,
  validateServerUrl,
} from './config';
import {
  appIconPath,
  preloadPath,
  rendererPageUrl,
  trayIconPath,
} from './paths';
import {
  initNotifications,
  showDesktopNotification,
} from './notifications';
import {
  cancelDisplayPicker,
  registerPickerIpc,
  setupDisplayMediaHandler,
} from './screenCapture';
import {
  getShortcutStatuses,
  registerDesktopShortcuts,
  unregisterDesktopShortcuts,
} from './shortcuts';
import {
  checkForUpdates,
  getUpdateState,
  initUpdater,
  installUpdate,
} from './updater';
import type {
  DesktopConfig,
  DesktopShortcut,
  SaveSettingsResult,
  SettingsPayload,
  SettingsSnapshot,
  TestServerResult,
} from '../shared/types';

const userDataOverride = process.env.NEBULA_USER_DATA_DIR;
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let loadFailureDialogOpen = false;

function argumentValue(name: string): string | null {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function normalizeServerUrl(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/\/+$/, '');
  return validateServerUrl(value) === null ? value : null;
}

const cliServerUrl = normalizeServerUrl(
  argumentValue('--server-url') ?? process.env.NEBULA_SERVER_URL ?? null,
);

function snapshot(): SettingsSnapshot {
  const config = getConfig();
  return {
    ...config,
    appVersion: app.getVersion(),
    serverUrl: getServerUrl(config),
    update: getUpdateState(),
    shortcuts: getShortcutStatuses(),
    platform: process.platform,
    packaged: app.isPackaged,
  };
}

function iconImage(): NativeImage | undefined {
  try {
    const image = nativeImage.createFromPath(appIconPath());
    return image.isEmpty() ? undefined : image;
  } catch {
    return undefined;
  }
}

function refreshShortcuts(): void {
  const config = getConfig();
  registerDesktopShortcuts({
    enabled: config.shortcutsEnabled,
    toggleWindow: toggleMainWindow,
    sendAction: sendShortcutAction,
  });
}

function applyLoginItemSettings(): void {
  if (!app.isPackaged) return;
  const config = getConfig();
  app.setLoginItemSettings({
    openAtLogin: config.autoStart,
    args: config.startMinimized ? ['--hidden'] : [],
  });
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function toggleMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (getConfig().configured) {
      createMainWindow(getServerUrl(), true);
    } else {
      openSettings(true);
    }
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }
  focusWindow(mainWindow);
}

function sendShortcutAction(action: DesktopShortcut): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:shortcut', action);
}

function createMainWindow(serverUrl: string, show = true): void {
  const urlError = validateServerUrl(serverUrl);
  if (urlError) {
    void dialog.showMessageBox({
      type: 'error',
      title: '服务器地址不可用',
      message: urlError,
    });
    return;
  }

  cancelDisplayPicker();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  mainWindow = null;

  const normalizedUrl = serverUrl.replace(/\/+$/, '');
  const partition = `persist:nebula-${createHash('sha256')
    .update(normalizedUrl)
    .digest('hex')
    .slice(0, 16)}`;
  const serverSession = session.fromPartition(partition);
  configureServerSession(serverSession, normalizedUrl);

  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d14',
    title: 'Nebula',
    icon: iconImage(),
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      preload: preloadPath('index'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mainWindow = window;
  window.setMenuBarVisibility(false);

  window.once('ready-to-show', () => {
    if (show && mainWindow === window && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });

  window.on('close', (event) => {
    if (isQuitting) return;
    if (getConfig().closeToTray && tray) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (isSameOrigin(targetUrl, normalizedUrl)) return;
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      if (mainWindow !== window) return;
      void handleLoadFailure(
        window,
        normalizedUrl,
        errorCode,
        errorDescription,
        failedUrl,
      );
    },
  );

  void window.loadURL(normalizedUrl);
}

async function handleLoadFailure(
  window: BrowserWindow,
  serverUrl: string,
  errorCode: number,
  description: string,
  failedUrl: string,
): Promise<void> {
  if (loadFailureDialogOpen) return;
  loadFailureDialogOpen = true;
  try {
    const result = await dialog.showMessageBox(window, {
      type: 'error',
      title: '无法连接到 Nebula',
      message: '无法加载服务器页面',
      detail: `${serverUrl}\n\n${description} (${errorCode})\n${failedUrl}`,
      buttons: ['重试', '打开设置', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (result.response === 0) {
      void window.loadURL(serverUrl);
    } else if (result.response === 1) {
      openSettings(false);
    } else {
      isQuitting = true;
      app.quit();
    }
  } finally {
    loadFailureDialogOpen = false;
  }
}

function isSameOrigin(candidate: string, serverUrl: string): boolean {
  try {
    return new URL(candidate).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function configureServerSession(serverSession: Electron.Session, serverUrl: string): void {
  const allowedOrigin = new URL(serverUrl).origin;

  const isAllowed = (permission: string, requestingUrl: string): boolean => {
    let origin = '';
    try {
      origin = new URL(requestingUrl).origin;
    } catch {
      return false;
    }
    if (origin !== allowedOrigin) return false;
    return (
      permission === 'media' ||
      permission === 'display-capture' ||
      permission === 'clipboard-sanitized-write'
    );
  };

  serverSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrl =
        'requestingUrl' in details && details.requestingUrl
          ? details.requestingUrl
          : webContents.getURL();
      callback(isAllowed(permission, requestingUrl));
    },
  );

  serverSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) => {
      const url = requestingOrigin || webContents?.getURL() || '';
      return isAllowed(permission, url);
    },
  );

  setupDisplayMediaHandler(serverSession, () => mainWindow);
}

function openSettings(firstRun = false): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    focusWindow(settingsWindow);
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 920,
    height: 920,
    minWidth: 760,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d14',
    title: firstRun ? '欢迎使用 Nebula' : 'Nebula 设置',
    icon: iconImage(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath('settings'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.focus();
    }
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (!mainWindow) {
      isQuitting = true;
      app.quit();
    }
  });

  const target = new URL(rendererPageUrl('settings.html'));
  if (firstRun) target.searchParams.set('firstRun', '1');
  void settingsWindow.loadURL(target.toString());
}

function createTray(): void {
  if (tray) return;
  let image = nativeImage.createFromPath(trayIconPath());
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(appIconPath());
  }
  if (image.isEmpty()) {
    console.warn('[tray] icon could not be loaded; close-to-tray will be disabled');
    return;
  }

  try {
    tray = new Tray(image);
    tray.setToolTip('Nebula');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示 / 隐藏窗口',
          click: () => toggleMainWindow(),
        },
        { type: 'separator' },
        {
          label: '静音 / 取消静音',
          click: () => sendShortcutAction('toggle-mute'),
        },
        {
          label: '离开语音',
          click: () => sendShortcutAction('leave-voice'),
        },
        { type: 'separator' },
        {
          label: '设置…',
          click: () => openSettings(false),
        },
        {
          label: '退出 Nebula',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', () => toggleMainWindow());
    tray.on('double-click', () => {
      if (mainWindow) focusWindow(mainWindow);
    });
  } catch (error) {
    console.warn('[tray] failed to create tray icon', error);
    tray = null;
  }
}

function isMainSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender.id === mainWindow.webContents.id,
  );
}

function isSettingsSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return Boolean(
    settingsWindow &&
      !settingsWindow.isDestroyed() &&
      event.sender.id === settingsWindow.webContents.id,
  );
}

function describeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ERR_CERT|CERT_AUTHORITY|CERT_COMMON_NAME|CERT_DATE/i.test(message)) {
    return '证书不受信任：请安装服务器根证书，或使用受信任的 HTTPS 证书';
  }
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(message)) {
    return '连接被拒绝：请确认服务已启动、端口正确';
  }
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(message)) {
    return '无法解析服务器地址';
  }
  if (/ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED/i.test(message)) {
    return '无法连接到服务器，请检查网络';
  }
  if (/ERR_SSL|SSL/i.test(message)) {
    return 'TLS 握手失败，请检查 HTTPS 配置';
  }
  return message.slice(0, 240);
}

async function testServerUrl(raw: unknown): Promise<TestServerResult> {
  if (typeof raw !== 'string') {
    return { ok: false, error: '服务器地址无效' };
  }
  const url = raw.trim().replace(/\/+$/, '');
  const error = validateServerUrl(url);
  if (error) return { ok: false, error };

  try {
    const response = await net.fetch(`${url}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `服务器返回 HTTP ${response.status}` };
    }
    const data = (await response.json().catch(() => null)) as
      | { status?: string }
      | null;
    if (!data || data.status !== 'ok') {
      return { ok: false, status: response.status, error: '服务器响应不是 Nebula API' };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: describeNetworkError(error) };
  }
}

function registerIpcHandlers(): void {
  registerPickerIpc();

  ipcMain.handle('settings:get', (event): SettingsSnapshot => {
    if (!isSettingsSender(event)) throw new Error('Invalid settings window');
    return snapshot();
  });

  ipcMain.handle('settings:test-server', async (event, raw: unknown): Promise<TestServerResult> => {
    if (!isSettingsSender(event)) return { ok: false, error: 'Invalid settings window' };
    return testServerUrl(raw);
  });

  ipcMain.handle(
    'settings:save',
    async (event, raw: unknown): Promise<SaveSettingsResult> => {
      if (!isSettingsSender(event)) return { ok: false, error: 'Invalid settings window' };
      if (!raw || typeof raw !== 'object') {
        return { ok: false, error: '设置数据无效' };
      }
      const payload = raw as Partial<SettingsPayload>;
      const mode = payload.mode === 'remote' ? 'remote' : 'local';
      const remoteUrl =
        typeof payload.remoteUrl === 'string'
          ? payload.remoteUrl.trim().replace(/\/+$/, '')
          : '';
      const localUrl =
        typeof payload.localUrl === 'string'
          ? payload.localUrl.trim().replace(/\/+$/, '')
          : '';
      const selected = mode === 'remote' ? remoteUrl : localUrl;
      const urlError = validateServerUrl(selected);
      if (urlError) return { ok: false, error: urlError };

      const previous = getConfig();
      const previousServer = getServerUrl(previous);
      const next: DesktopConfig = {
        ...previous,
        configured: true,
        mode,
        remoteUrl,
        localUrl: localUrl || previous.localUrl,
        autoStart: payload.autoStart === true,
        startMinimized: payload.startMinimized === true,
        closeToTray: payload.closeToTray !== false,
        notifications: payload.notifications !== false,
        shortcutsEnabled: payload.shortcutsEnabled !== false,
      };
      saveConfig(next);
      applyLoginItemSettings();
      refreshShortcuts();

      const nextServer = getServerUrl(next);
      if (nextServer !== previousServer || !mainWindow) {
        createMainWindow(nextServer, true);
      }

      return { ok: true, snapshot: snapshot() };
    },
  );

  ipcMain.on('settings:close', (event) => {
    if (!isSettingsSender(event) || !settingsWindow) return;
    settingsWindow.close();
  });

  ipcMain.handle('updater:check', async (event) => {
    if (!isSettingsSender(event)) throw new Error('Invalid settings window');
    return checkForUpdates();
  });

  ipcMain.handle('updater:install', (event) => {
    if (!isSettingsSender(event)) return false;
    installUpdate();
    return true;
  });

  ipcMain.handle('updater:state', (event) => {
    if (!isSettingsSender(event)) throw new Error('Invalid settings window');
    return getUpdateState();
  });

  ipcMain.on('app:open-external', (event, url: unknown) => {
    if (!isSettingsSender(event) || typeof url !== 'string') return;
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  ipcMain.on('desktop:notify', (event, payload: unknown) => {
    if (!isMainSender(event) || !payload || typeof payload !== 'object') return;
    const { title, body } = payload as { title?: unknown; body?: unknown };
    if (typeof title !== 'string' || typeof body !== 'string') return;
    showDesktopNotification(title, body);
  });

  ipcMain.on('desktop:open-settings', (event) => {
    if (isMainSender(event)) openSettings(false);
  });

  ipcMain.handle('app:version', (event) => {
    if (!isSettingsSender(event)) throw new Error('Invalid settings window');
    return app.getVersion();
  });
}

function initialize(): void {
  app.setAppUserModelId('com.nebula.chat');
  Menu.setApplicationMenu(null);
  const config = loadConfig();

  initNotifications(() => mainWindow);
  initUpdater((state) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('updater:state', state);
    }
  });
  registerIpcHandlers();
  createTray();
  applyLoginItemSettings();
  refreshShortcuts();

  const serverUrl = cliServerUrl ?? (config.configured ? getServerUrl(config) : '');
  if (serverUrl) {
    const hidden =
      process.argv.includes('--hidden') ||
      (!cliServerUrl && config.startMinimized);
    createMainWindow(serverUrl, !hidden || !tray);
  } else {
    openSettings(true);
  }
}

if (singleInstance) {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      focusWindow(mainWindow);
      return;
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      focusWindow(settingsWindow);
      return;
    }
    if (getConfig().configured) {
      createMainWindow(getServerUrl(), true);
    } else {
      openSettings(true);
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    cancelDisplayPicker();
  });

  app.on('will-quit', () => {
    unregisterDesktopShortcuts();
  });

  app.on('window-all-closed', () => {
    if (isQuitting) return;
    if (!tray || !getConfig().closeToTray) {
      app.quit();
    }
  });

  app
    .whenReady()
    .then(initialize)
    .catch((error) => {
      console.error('[main] failed to initialize', error);
      dialog.showErrorBox(
        'Nebula 启动失败',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
}
