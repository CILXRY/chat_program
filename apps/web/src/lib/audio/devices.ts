import type { AudioInputDevice, AudioOutputInfo, OutputKind } from './types';

const HEADPHONE_PATTERN =
  /headphone|headset|earphone|earbud|airpod|beats|wh-?1000|qc\s?\d|buds|耳机|耳麥|耳麦|头戴|耳塞|监听|監聽/i;
const SPEAKER_PATTERN =
  /speaker|monitor|display|hdmi|displayport|tv|soundbar|扬声器|揚聲器|音箱|显示器|顯示器|电视|電視/i;

export function classifyOutputLabel(label: string): OutputKind {
  if (HEADPHONE_PATTERN.test(label)) return 'headphones';
  if (SPEAKER_PATTERN.test(label)) return 'speakers';
  return 'unknown';
}

interface TauriAudioOutputInfo {
  label?: string;
  isHeadphones?: boolean;
  isSpeakers?: boolean;
}

async function nativeOutputInfo(): Promise<AudioOutputInfo | null> {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return null;
  try {
    const info = await tauri.core.invoke<TauriAudioOutputInfo>('audio_output_info');
    if (!info || typeof info.label !== 'string') return null;
    const kind: OutputKind = info.isHeadphones
      ? 'headphones'
      : info.isSpeakers
        ? 'speakers'
        : classifyOutputLabel(info.label);
    return { kind, label: info.label, detected: kind !== 'unknown' };
  } catch {
    return null;
  }
}

async function browserOutputInfo(): Promise<AudioOutputInfo> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { kind: 'unknown', label: '', detected: false };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    const labelled = outputs.filter((device) => device.label.trim().length > 0);
    // Chromium exposes the default output first. Its label is the closest
    // browser-side equivalent to the OS endpoint that AEC actually cancels.
    const candidate = labelled[0];
    if (!candidate) return { kind: 'unknown', label: '', detected: false };
    const kind = classifyOutputLabel(candidate.label);
    return { kind, label: candidate.label, detected: kind !== 'unknown' };
  } catch {
    return { kind: 'unknown', label: '', detected: false };
  }
}

export async function detectOutputInfo(): Promise<AudioOutputInfo> {
  return (await nativeOutputInfo()) ?? (await browserOutputInfo());
}

export async function listInputDevices(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const seen = new Set<string>();
    const inputs: AudioInputDevice[] = [];
    for (const device of devices) {
      if (device.kind !== 'audioinput') continue;
      const id = device.deviceId || '';
      if (seen.has(id) || id === 'default' || id === 'communications') continue;
      seen.add(id);
      inputs.push({
        deviceId: id,
        label: device.label || `麦克风 ${inputs.length + 1}`,
      });
    }
    return inputs;
  } catch {
    return [];
  }
}

export function onMediaDevicesChanged(callback: () => void): () => void {
  const media = navigator.mediaDevices;
  if (!media?.addEventListener) return () => undefined;
  media.addEventListener('devicechange', callback);
  return () => media.removeEventListener('devicechange', callback);
}
