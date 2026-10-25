import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopShortcut } from '../shared/types';

const api = {
  platform: process.platform,
  notify: (title: string, body: string): void => {
    ipcRenderer.send('desktop:notify', { title, body });
  },
  onShortcut: (callback: (action: DesktopShortcut) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, action: DesktopShortcut) => {
      callback(action);
    };
    ipcRenderer.on('desktop:shortcut', listener);
    return () => ipcRenderer.removeListener('desktop:shortcut', listener);
  },
  openSettings: (): void => {
    ipcRenderer.send('desktop:open-settings');
  },
  retryScreenShareWithoutAudio: (): void => {
    ipcRenderer.send('desktop:retry-screen-without-audio');
  },
};

contextBridge.exposeInMainWorld('nebulaDesktop', api);
