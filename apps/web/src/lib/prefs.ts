import { useSyncExternalStore } from 'react';
import {
  DEFAULT_AUDIO_PREFS,
  isAecMode,
  isAnsModel,
  isOutputOverride,
  type AudioPrefs,
} from './audio/types';

export type MessageDensity = 'comfortable' | 'compact';
export type ScreenQuality = '720p' | '900p' | '1080p';

export interface Prefs {
  desktopNotifications: boolean;
  messageDensity: MessageDensity;
  screenQuality: ScreenQuality;
  audio: AudioPrefs;
}

const KEY = 'nebula:prefs';

const DEFAULTS: Prefs = {
  desktopNotifications: true,
  messageDensity: 'comfortable',
  screenQuality: '900p',
  audio: DEFAULT_AUDIO_PREFS,
};

function normalizeScreenQuality(value: unknown): ScreenQuality {
  return value === '720p' || value === '1080p' ? value : '900p';
}

function normalizeAudio(value: unknown): AudioPrefs {
  const audio = (value ?? {}) as Partial<AudioPrefs>;
  return {
    micDeviceId: typeof audio.micDeviceId === 'string' ? audio.micDeviceId : '',
    aecMode: isAecMode(audio.aecMode) ? audio.aecMode : DEFAULT_AUDIO_PREFS.aecMode,
    ansModel: isAnsModel(audio.ansModel) ? audio.ansModel : DEFAULT_AUDIO_PREFS.ansModel,
    outputOverride: isOutputOverride(audio.outputOverride)
      ? audio.outputOverride
      : DEFAULT_AUDIO_PREFS.outputOverride,
    agc: audio.agc !== false,
    vadThresholdDb:
      typeof audio.vadThresholdDb === 'number' && Number.isFinite(audio.vadThresholdDb)
        ? Math.max(0, Math.min(30, audio.vadThresholdDb))
        : DEFAULT_AUDIO_PREFS.vadThresholdDb,
    gate: audio.gate !== false,
  };
}

function read(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const value = JSON.parse(raw) as Partial<Prefs> | null;
    return {
      desktopNotifications: value?.desktopNotifications !== false,
      messageDensity: value?.messageDensity === 'compact' ? 'compact' : 'comfortable',
      screenQuality: normalizeScreenQuality(value?.screenQuality),
      audio: normalizeAudio(value?.audio),
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
  current = {
    ...current,
    ...patch,
    audio: patch.audio ? normalizeAudio(patch.audio) : current.audio,
  };
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
