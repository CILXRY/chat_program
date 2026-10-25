import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  SaveSettingsResult,
  SettingsPayload,
  SettingsSnapshot,
  TestServerResult,
  UpdateState,
} from '../shared/types';

contextBridge.exposeInMainWorld('nebulaSettings', {
  get: (): Promise<SettingsSnapshot> => ipcRenderer.invoke('settings:get'),
  save: (payload: SettingsPayload): Promise<SaveSettingsResult> =>
    ipcRenderer.invoke('settings:save', payload),
  testServer: (url: string): Promise<TestServerResult> =>
    ipcRenderer.invoke('settings:test-server', url),
  close: (): void => ipcRenderer.send('settings:close'),
  checkUpdates: (): Promise<UpdateState> => ipcRenderer.invoke('updater:check'),
  installUpdate: (): void => {
    void ipcRenderer.invoke('updater:install');
  },
  openExternal: (url: string): void => ipcRenderer.send('app:open-external', url),
  onUpdateState: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: UpdateState) => {
      callback(state);
    };
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  },
});
