import { useSyncExternalStore } from 'react';

export type MessageDensity = 'comfortable' | 'compact';

export interface Prefs {
  desktopNotifications: boolean;
  messageDensity: MessageDensity;
}

const KEY = 'nebula:prefs';

const DEFAULTS: Prefs = {
  desktopNotifications: true,
  messageDensity: 'comfortable',
};

function read(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const value = JSON.parse(raw) as Partial<Prefs> | null;
    return {
      desktopNotifications: value?.desktopNotifications !== false,
      messageDensity: value?.messageDensity === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Preferences are best-effort.
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}
