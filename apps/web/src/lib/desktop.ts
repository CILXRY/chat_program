import { invokeTauri, isTauri, type TauriEvent } from './tauri';

export type DesktopShortcut = 'toggle-mute' | 'leave-voice';

interface LegacyDesktopBridge {
  platform: string;
  notify: (title: string, body: string) => void;
  onShortcut: (callback: (action: DesktopShortcut) => void) => () => void;
  openSettings: () => void;
  retryScreenShareWithoutAudio?: () => void;
}

declare global {
  interface Window {
    nebulaDesktop?: LegacyDesktopBridge;
  }
}

export function isDesktopClient(): boolean {
  return (
    typeof window !== 'undefined' &&
    (Boolean(window.nebulaDesktop) || isTauri())
  );
}

export function notifyDesktop(title: string, body: string): void {
  if (isTauri()) {
    void invokeTauri('desktop_notify', { title, body });
    return;
  }
  try {
    window.nebulaDesktop?.notify(title, body);
  } catch (error) {
    console.warn('[desktop] notification failed', error);
  }
}

export function onDesktopShortcut(
  callback: (action: DesktopShortcut) => void,
): () => void {
  if (isTauri()) {
    const events = window.__TAURI__?.event as TauriEvent | undefined;
    if (!events) return () => undefined;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void events
      .listen<string>('desktop:shortcut', (event) => {
        if (event.payload === 'toggle-mute' || event.payload === 'leave-voice') {
          callback(event.payload);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => console.warn('[desktop] shortcut listener failed', error));
    return () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    };
  }

  try {
    return window.nebulaDesktop?.onShortcut(callback) ?? (() => undefined);
  } catch (error) {
    console.warn('[desktop] shortcut bridge failed', error);
    return () => undefined;
  }
}

export async function logoutDesktop(): Promise<boolean> {
  if (!isTauri()) return false;
  return (await invokeTauri<boolean>('desktop_logout')) === true;
}

export function openDesktopSettings(): void {
  if (isTauri()) {
    void invokeTauri('desktop_open_settings');
    return;
  }
  try {
    window.nebulaDesktop?.openSettings();
  } catch (error) {
    console.warn('[desktop] settings bridge failed', error);
  }
}

export function desktopPlatform(): string | null {
  if (typeof window === 'undefined') return null;
  if (isTauri()) return 'win32';
  return window.nebulaDesktop?.platform ?? null;
}
