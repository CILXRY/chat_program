import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  type DesktopCapturerSource,
  type IpcMainInvokeEvent,
  type Session,
  type Streams,
} from 'electron';
import type { PickerSource } from '../shared/types';
import { rendererPageUrl, preloadPath } from './paths';

type DisplayCallback = (streams: Streams | null) => void;

let pendingCallback: DisplayCallback | null = null;
let pickerWindow: BrowserWindow | null = null;
let sourceMap = new Map<string, DesktopCapturerSource>();
let getMainWindow: () => BrowserWindow | null = () => null;
let lastSelection: { id: string; name: string } | null = null;
let retryWithoutAudio = false;
let retryTimer: NodeJS.Timeout | null = null;

export function setupDisplayMediaHandler(
  targetSession: Session,
  mainWindowGetter: () => BrowserWindow | null,
): void {
  getMainWindow = mainWindowGetter;

  targetSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    if (pendingCallback) {
      callback(null);
      return;
    }

    // The renderer requested an automatic video-only retry after the Windows
    // loopback audio device failed. Reuse the previous source and skip the
    // picker so the user does not have to choose twice.
    if (retryWithoutAudio) {
      retryWithoutAudio = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      try {
        if (lastSelection) {
          const sources = await fetchSources();
          const source =
            sources.find((item) => item.id === lastSelection?.id) ?? null;
          if (source) {
            callback({ video: { id: source.id, name: source.name } });
            return;
          }
        }
      } catch (error) {
        console.warn('[screen] failed to reuse the previous source', error);
      }
    }

    pendingCallback = callback;
    try {
      const sources = await fetchSources();
      if (sources.length === 0) {
        cancelDisplayPicker();
        return;
      }
      openPickerWindow();
    } catch (error) {
      console.warn('[screen] failed to enumerate capture sources', error);
      cancelDisplayPicker();
    }
  });
}

async function fetchSources(): Promise<DesktopCapturerSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 360, height: 200 },
    fetchWindowIcons: true,
  });
  sourceMap = new Map(sources.map((source) => [source.id, source]));
  return sources;
}

async function getPickerSources(): Promise<PickerSource[]> {
  const sources = await fetchSources();
  return sources.map((source) => ({
    id: source.id,
    name: source.name || (source.id.startsWith('screen:') ? '屏幕' : '窗口'),
    thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
    isScreen: source.id.startsWith('screen:'),
    supportsAudio: process.platform === 'win32' && source.id.startsWith('screen:'),
  }));
}

function openPickerWindow(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.focus();
    return;
  }

  const parent = getMainWindow();
  pickerWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 760,
    minHeight: 540,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal: Boolean(parent && !parent.isDestroyed()),
    show: false,
    title: '选择要共享的内容',
    backgroundColor: '#0b0d14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath('picker'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  pickerWindow.setMenuBarVisibility(false);
  pickerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pickerWindow.once('ready-to-show', () => {
    pickerWindow?.show();
    pickerWindow?.focus();
  });
  pickerWindow.on('closed', () => {
    pickerWindow = null;
    cancelPendingRequest();
  });

  void pickerWindow.loadURL(rendererPageUrl('picker.html'));
}

function cancelPendingRequest(): void {
  const callback = pendingCallback;
  pendingCallback = null;
  callback?.(null);
}

export function cancelDisplayPicker(): void {
  cancelPendingRequest();
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.close();
  }
  pickerWindow = null;
  sourceMap.clear();
}

function closePickerWindow(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.close();
  }
  pickerWindow = null;
}

function isPickerSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    pickerWindow &&
      !pickerWindow.isDestroyed() &&
      event.sender.id === pickerWindow.webContents.id,
  );
}

export function registerPickerIpc(): void {
  ipcMain.handle(
    'picker:get-sources',
    async (event): Promise<PickerSource[]> => {
      if (!isPickerSender(event)) return [];
      return getPickerSources();
    },
  );

  ipcMain.handle(
    'picker:select',
    async (
      event,
      payload: { sourceId?: unknown; withAudio?: unknown },
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!isPickerSender(event)) return { ok: false, error: 'Invalid window' };
      if (typeof payload?.sourceId !== 'string') {
        return { ok: false, error: 'No source selected' };
      }
      if (!pendingCallback) {
        return { ok: false, error: 'No pending capture request' };
      }

      let source = sourceMap.get(payload.sourceId);
      if (!source) {
        await fetchSources();
        source = sourceMap.get(payload.sourceId);
      }
      if (!source) {
        return { ok: false, error: 'The selected source is no longer available' };
      }

      const withAudio =
        payload.withAudio === true &&
        process.platform === 'win32' &&
        source.id.startsWith('screen:');

      lastSelection = { id: source.id, name: source.name };
      const streams: Streams = {
        video: { id: source.id, name: source.name },
      };
      if (withAudio) {
        streams.audio = 'loopback';
      }

      const callback = pendingCallback;
      pendingCallback = null;
      try {
        callback(streams);
      } catch (error) {
        console.warn('[screen] failed to start capture', error);
        closePickerWindow();
        return { ok: false, error: 'Failed to start screen capture' };
      }

      closePickerWindow();
      sourceMap.clear();
      return { ok: true };
    },
  );

  ipcMain.on('picker:cancel', (event) => {
    if (event.sender.id !== pickerWindow?.webContents.id) return;
    cancelDisplayPicker();
  });

  ipcMain.on('desktop:retry-screen-without-audio', (event) => {
    if (event.sender.id !== getMainWindow()?.webContents.id) return;
    retryWithoutAudio = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryWithoutAudio = false;
      retryTimer = null;
    }, 5000);
  });
}
