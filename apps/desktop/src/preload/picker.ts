import { contextBridge, ipcRenderer } from 'electron';
import type { PickerSource } from '../shared/types';

contextBridge.exposeInMainWorld('nebulaPicker', {
  getSources: (): Promise<PickerSource[]> => ipcRenderer.invoke('picker:get-sources'),
  select: (
    sourceId: string,
    withAudio: boolean,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('picker:select', { sourceId, withAudio }),
  cancel: (): void => ipcRenderer.send('picker:cancel'),
});
