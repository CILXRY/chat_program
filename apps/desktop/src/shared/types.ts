export type ServerMode = 'remote' | 'local';
export type DesktopShortcut = 'toggle-mute' | 'leave-voice';
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error';

export interface DesktopConfig {
  version: 1;
  configured: boolean;
  mode: ServerMode;
  remoteUrl: string;
  localUrl: string;
  autoStart: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  notifications: boolean;
  shortcutsEnabled: boolean;
}

export const DEFAULT_CONFIG: DesktopConfig = {
  version: 1,
  configured: false,
  mode: 'local',
  remoteUrl: '',
  localUrl: 'http://localhost:8080',
  autoStart: false,
  startMinimized: false,
  closeToTray: true,
  notifications: true,
  shortcutsEnabled: true,
};

export interface ShortcutStatus {
  accelerator: string;
  label: string;
  action: string;
  registered: boolean;
}

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  message?: string;
}

export interface SettingsSnapshot extends DesktopConfig {
  appVersion: string;
  serverUrl: string;
  update: UpdateState;
  shortcuts: ShortcutStatus[];
  platform: string;
  packaged: boolean;
}

export interface SettingsPayload {
  mode: ServerMode;
  remoteUrl: string;
  localUrl: string;
  autoStart: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  notifications: boolean;
  shortcutsEnabled: boolean;
}

export interface SaveSettingsResult {
  ok: boolean;
  error?: string;
  snapshot?: SettingsSnapshot;
}

export interface TestServerResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface PickerSource {
  id: string;
  name: string;
  thumbnail: string;
  isScreen: boolean;
  supportsAudio: boolean;
}

export interface DesktopBridge {
  platform: string;
  notify: (title: string, body: string) => void;
  onShortcut: (callback: (action: DesktopShortcut) => void) => () => void;
  openSettings: () => void;
}

export interface SettingsBridge {
  get: () => Promise<SettingsSnapshot>;
  save: (payload: SettingsPayload) => Promise<SaveSettingsResult>;
  testServer: (url: string) => Promise<TestServerResult>;
  close: () => void;
  checkUpdates: () => Promise<UpdateState>;
  installUpdate: () => void;
  openExternal: (url: string) => void;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
}

export interface PickerBridge {
  getSources: () => Promise<PickerSource[]>;
  select: (sourceId: string, withAudio: boolean) => Promise<{ ok: boolean; error?: string }>;
  cancel: () => void;
}

declare global {
  interface Window {
    nebulaDesktop?: DesktopBridge;
    nebulaSettings?: SettingsBridge;
    nebulaPicker?: PickerBridge;
  }
}

export {};
