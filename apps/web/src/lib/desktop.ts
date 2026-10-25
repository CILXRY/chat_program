export type DesktopShortcut = 'toggle-mute' | 'leave-voice';

interface DesktopBridge {
  platform: string;
  notify: (title: string, body: string) => void;
  onShortcut: (callback: (action: DesktopShortcut) => void) => () => void;
  openSettings: () => void;
  retryScreenShareWithoutAudio?: () => void;
}

declare global {
  interface Window {
    nebulaDesktop?: DesktopBridge;
  }
}

export function isDesktopClient(): boolean {
  return typeof window !== 'undefined' && Boolean(window.nebulaDesktop);
}

export function notifyDesktop(title: string, body: string): void {
  try {
    window.nebulaDesktop?.notify(title, body);
  } catch (error) {
    console.warn('[desktop] notification failed', error);
  }
}

export function onDesktopShortcut(
  callback: (action: DesktopShortcut) => void,
): () => void {
  try {
    return window.nebulaDesktop?.onShortcut(callback) ?? (() => undefined);
  } catch (error) {
    console.warn('[desktop] shortcut bridge failed', error);
    return () => undefined;
  }
}

export function openDesktopSettings(): void {
  try {
    window.nebulaDesktop?.openSettings();
  } catch (error) {
    console.warn('[desktop] settings bridge failed', error);
  }
}

export function desktopPlatform(): string | null {
  if (typeof window === 'undefined') return null;
  return window.nebulaDesktop?.platform ?? null;
}
