import type {
  ServerMode,
  SettingsPayload,
  SettingsSnapshot,
  ShortcutStatus,
  UpdateState,
} from '../shared/types';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const api = window.nebulaSettings!;
if (!api) {
  document.body.innerHTML =
    '<main style="padding:40px;color:#ff8199;font-family:system-ui">Nebula 设置窗口未正确加载预加载脚本。</main>';
  throw new Error('nebulaSettings preload API is missing');
}

const firstRun = new URLSearchParams(location.search).get('firstRun') === '1';
let snapshot: SettingsSnapshot;
let mode: ServerMode = 'local';
let saving = false;
let testing = false;

const form = byId<HTMLFormElement>('settings-form');
const remoteUrl = byId<HTMLInputElement>('remote-url');
const localUrl = byId<HTMLInputElement>('local-url');
const testButton = byId<HTMLButtonElement>('test-server');
const testResult = byId<HTMLSpanElement>('test-result');
const urlWarning = byId<HTMLParagraphElement>('url-warning');
const saveButton = byId<HTMLButtonElement>('save-settings');
const saveStatus = byId<HTMLSpanElement>('save-status');
const formError = byId<HTMLDivElement>('form-error');
const closeButton = byId<HTMLButtonElement>('close-settings');
const checkUpdatesButton = byId<HTMLButtonElement>('check-updates');
const installUpdateButton = byId<HTMLButtonElement>('install-update');
const updateStatus = byId<HTMLParagraphElement>('update-status');
const shortcutList = byId<HTMLDivElement>('shortcut-list');

const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-mode]'),
);

function activeUrl(): string {
  return mode === 'remote' ? remoteUrl.value.trim() : localUrl.value.trim();
}

function setMode(next: ServerMode, focus = false): void {
  mode = next;
  for (const button of modeButtons) {
    button.classList.toggle('active', button.dataset.mode === mode);
    button.setAttribute('aria-selected', String(button.dataset.mode === mode));
  }
  updateHttpWarning();
  if (focus) {
    (mode === 'remote' ? remoteUrl : localUrl).focus();
  }
}

function updateHttpWarning(): void {
  const raw = activeUrl();
  let warning = '';
  if (raw) {
    try {
      const parsed = new URL(raw);
      const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
      if (parsed.protocol === 'http:' && !localHosts.has(parsed.hostname)) {
        warning =
          '这个地址不是 localhost，浏览器会禁止麦克风和屏幕共享。请改用 HTTPS，或只在当前电脑上使用本机地址。';
      }
      if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') {
        warning = '';
      }
    } catch {
      warning = '';
    }
  }
  urlWarning.textContent = warning;
  urlWarning.hidden = !warning;
}

function showFormError(message: string): void {
  formError.textContent = message;
  formError.hidden = !message;
}

function setTestResult(
  message: string,
  kind: 'idle' | 'pending' | 'ok' | 'bad' = 'idle',
): void {
  testResult.textContent = message;
  testResult.className = `test-result ${kind === 'idle' ? '' : kind}`;
}

function renderShortcuts(shortcuts: ShortcutStatus[]): void {
  shortcutList.replaceChildren();
  for (const shortcut of shortcuts) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';

    const label = document.createElement('div');
    label.className = 'shortcut-label';
    const status = document.createElement('span');
    status.className = `shortcut-status${shortcut.registered ? '' : ' off'}`;
    status.title = shortcut.registered ? '已注册' : '未注册（可能被其他程序占用）';
    const text = document.createElement('span');
    text.textContent = shortcut.label;
    label.append(status, text);

    const key = document.createElement('kbd');
    key.textContent = shortcut.accelerator
      .replace('CommandOrControl', 'Ctrl')
      .replaceAll('+', ' + ');

    row.append(label, key);
    shortcutList.append(row);
  }
}

function renderUpdate(state: UpdateState): void {
  installUpdateButton.hidden = state.status !== 'downloaded';
  checkUpdatesButton.disabled = state.status === 'checking' || state.status === 'downloading';

  switch (state.status) {
    case 'checking':
      updateStatus.textContent = '正在检查更新…';
      break;
    case 'available':
      updateStatus.textContent = `发现新版本 ${state.version ?? ''}，准备下载…`;
      break;
    case 'downloading':
      updateStatus.textContent = `正在下载更新… ${state.percent ?? 0}%`;
      break;
    case 'downloaded':
      updateStatus.textContent = `新版本 ${state.version ?? ''} 已下载，重启后安装`;
      break;
    case 'not-available':
      updateStatus.textContent = state.message ?? '当前已是最新版本';
      break;
    case 'error':
      updateStatus.textContent = `更新检查失败：${state.message ?? '未知错误'}`;
      break;
    default:
      updateStatus.textContent = '尚未检查更新';
      break;
  }
}

function applySnapshot(next: SettingsSnapshot): void {
  snapshot = next;
  mode = next.mode;
  remoteUrl.value = next.remoteUrl;
  localUrl.value = next.localUrl;
  byId<HTMLInputElement>('auto-start').checked = next.autoStart;
  byId<HTMLInputElement>('start-minimized').checked = next.startMinimized;
  byId<HTMLInputElement>('close-to-tray').checked = next.closeToTray;
  byId<HTMLInputElement>('notifications').checked = next.notifications;
  byId<HTMLInputElement>('shortcuts-enabled').checked = next.shortcutsEnabled;
  byId<HTMLSpanElement>('app-version').textContent = `v${next.appVersion}`;
  byId<HTMLSpanElement>('brand-version').textContent = `v${next.appVersion}`;
  byId<HTMLSpanElement>('footer-version').textContent = `v${next.appVersion}`;
  byId<HTMLSpanElement>('packaged-badge').textContent = next.packaged
    ? '安装版'
    : '开发模式';
  renderShortcuts(next.shortcuts);
  renderUpdate(next.update);
  setMode(mode);
}

async function initialize(): Promise<void> {
  if (firstRun) {
    document.body.classList.add('first-run');
    closeButton.hidden = true;
    byId<HTMLHeadingElement>('page-title').textContent = '设置你的 Nebula';
    byId<HTMLParagraphElement>('page-subtitle').textContent =
      '第一次启动需要选择一个服务器。之后可以随时从托盘或设置里修改。';
    saveButton.textContent = '保存并开始使用';
  }

  try {
    const next = await api.get();
    applySnapshot(next);
  } catch (error) {
    showFormError(error instanceof Error ? error.message : String(error));
  }

  api.onUpdateState(renderUpdate);
  setTestResult('尚未测试');
}

function buildPayload(): SettingsPayload {
  return {
    mode,
    remoteUrl: remoteUrl.value.trim(),
    localUrl: localUrl.value.trim(),
    autoStart: byId<HTMLInputElement>('auto-start').checked,
    startMinimized: byId<HTMLInputElement>('start-minimized').checked,
    closeToTray: byId<HTMLInputElement>('close-to-tray').checked,
    notifications: byId<HTMLInputElement>('notifications').checked,
    shortcutsEnabled: byId<HTMLInputElement>('shortcuts-enabled').checked,
  };
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setMode(button.dataset.mode === 'remote' ? 'remote' : 'local', true);
    setTestResult('尚未测试');
  });
});

remoteUrl.addEventListener('input', updateHttpWarning);
localUrl.addEventListener('input', updateHttpWarning);

testButton.addEventListener('click', async () => {
  if (testing) return;
  testing = true;
  testButton.disabled = true;
  setTestResult('正在连接…', 'pending');
  try {
    const result = await api.testServer(activeUrl());
    if (result.ok) {
      setTestResult(`连接成功${result.status ? `（HTTP ${result.status}）` : ''}`, 'ok');
    } else {
      setTestResult(result.error ?? '连接失败', 'bad');
    }
  } catch (error) {
    setTestResult(error instanceof Error ? error.message : '连接失败', 'bad');
  } finally {
    testing = false;
    testButton.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  saving = true;
  showFormError('');
  saveStatus.textContent = '';
  saveButton.disabled = true;
  const originalLabel = saveButton.textContent;
  saveButton.textContent = '正在保存…';

  try {
    const result = await api.save(buildPayload());
    if (!result.ok) {
      showFormError(result.error ?? '保存失败');
      return;
    }
    if (result.snapshot) applySnapshot(result.snapshot);
    saveStatus.textContent = '已保存';
    if (firstRun) {
      window.setTimeout(() => api.close(), 500);
    }
  } catch (error) {
    showFormError(error instanceof Error ? error.message : '保存失败');
  } finally {
    saving = false;
    saveButton.disabled = false;
    saveButton.textContent = originalLabel;
  }
});

checkUpdatesButton.addEventListener('click', async () => {
  checkUpdatesButton.disabled = true;
  try {
    const state = await api.checkUpdates();
    renderUpdate(state);
  } catch (error) {
    updateStatus.textContent = `更新检查失败：${
      error instanceof Error ? error.message : '未知错误'
    }`;
  } finally {
    checkUpdatesButton.disabled = false;
  }
});

installUpdateButton.addEventListener('click', () => {
  api.installUpdate();
});

closeButton.addEventListener('click', () => api.close());

byId<HTMLButtonElement>('open-github').addEventListener('click', () => {
  api.openExternal('https://github.com/CILXRY/chat_program');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !firstRun) {
    api.close();
  }
});

void initialize();
