import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/types';
import { showDesktopNotification } from './notifications';

let state: UpdateState = { status: 'idle' };
let notifyState: (next: UpdateState) => void = () => {};
let initialized = false;
let checking = false;

function setState(next: UpdateState): void {
  state = next;
  notifyState({ ...state });
}

export function getUpdateState(): UpdateState {
  return { ...state };
}

export function initUpdater(onState: (next: UpdateState) => void): void {
  notifyState = onState;
  if (initialized) return;
  initialized = true;

  if (!app.isPackaged) {
    setState({
      status: 'not-available',
      message: '开发模式不检查更新',
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    setState({ status: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    setState({ status: 'not-available' });
  });
  autoUpdater.on('download-progress', (progress) => {
    setState({
      status: 'downloading',
      percent: Math.round(progress.percent * 10) / 10,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'downloaded', version: info.version });
    showDesktopNotification(
      'Nebula 更新已准备好',
      '重启客户端即可完成安装',
      () => installUpdate(),
    );
  });
  autoUpdater.on('error', (error) => {
    console.warn('[updater] check failed', error);
    setState({ status: 'error', message: error.message.slice(0, 300) });
  });

  setTimeout(() => {
    void checkForUpdates();
  }, 15000);
  const timer = setInterval(() => {
    void checkForUpdates();
  }, 6 * 60 * 60 * 1000);
  timer.unref();
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState({ status: 'not-available', message: '开发模式不检查更新' });
    return getUpdateState();
  }
  if (checking) return getUpdateState();
  checking = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState({ status: 'error', message: message.slice(0, 300) });
  } finally {
    checking = false;
  }
  return getUpdateState();
}

export function installUpdate(): void {
  if (state.status !== 'downloaded') return;
  autoUpdater.quitAndInstall(false, true);
}
