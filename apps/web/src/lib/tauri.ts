export interface TauriCore {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

export interface TauriEvent {
  listen: <T = unknown>(
    event: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
}

export interface TauriGlobal {
  core?: TauriCore;
  event?: TauriEvent;
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI__?.core?.invoke);
}

export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    return await window.__TAURI__!.core!.invoke<T>(command, args);
  } catch (error) {
    console.warn(`[tauri] ${command} failed`, error);
    return null;
  }
}
