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

export interface SettingsSnapshot {
  version: number;
  configured: boolean;
  mode: ServerMode;
  remoteUrl: string;
  localUrl: string;
  autoStart: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  notifications: boolean;
  shortcutsEnabled: boolean;
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

export interface TauriBridge {
  core: {
    invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event: {
    listen: <T = unknown>(
      event: string,
      handler: (event: { payload: T }) => void,
    ) => Promise<() => void>;
  };
}

declare global {
  interface Window {
    __TAURI__?: TauriBridge;
  }
}

export {};
