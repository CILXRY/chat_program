export type AecMode = 'auto' | 'on' | 'off';
export type AnsModel = 'off' | 'rnnoise' | 'deepfilternet3' | 'hush';
export type OutputKind = 'headphones' | 'speakers' | 'unknown';
export type OutputOverride = 'auto' | 'headphones' | 'speakers';

export interface AudioPrefs {
  /** Empty string means "system default". */
  micDeviceId: string;
  aecMode: AecMode;
  ansModel: AnsModel;
  /** Manual override for drivers that report a headset as "Speakers". */
  outputOverride: OutputOverride;
  agc: boolean;
  /** How far above the adaptive noise floor a frame must be to count as speech. */
  vadThresholdDb: number;
  /** Gate the outgoing stream while VAD is idle (Opus DTX finishes the job). */
  gate: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  micDeviceId: '',
  aecMode: 'auto',
  ansModel: 'rnnoise',
  outputOverride: 'auto',
  agc: true,
  vadThresholdDb: 8,
  gate: true,
};

export interface AudioMetrics {
  levelDb: number;
  noiseFloorDb: number;
  gainDb: number;
  peak: number;
  vad: boolean;
  echoLikelihood: number;
  multiSpeaker: boolean;
}

export const EMPTY_AUDIO_METRICS: AudioMetrics = {
  levelDb: -100,
  noiseFloorDb: -100,
  gainDb: 0,
  peak: 0,
  vad: false,
  echoLikelihood: 0,
  multiSpeaker: false,
};

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface AudioOutputInfo {
  kind: OutputKind;
  label: string;
  /** True when the output was matched by the operating-system device name. */
  detected: boolean;
}

export function isAnsModel(value: unknown): value is AnsModel {
  return (
    value === 'off' ||
    value === 'rnnoise' ||
    value === 'deepfilternet3' ||
    value === 'hush'
  );
}

export function isAecMode(value: unknown): value is AecMode {
  return value === 'auto' || value === 'on' || value === 'off';
}

export function isOutputOverride(value: unknown): value is OutputOverride {
  return value === 'auto' || value === 'headphones' || value === 'speakers';
}
