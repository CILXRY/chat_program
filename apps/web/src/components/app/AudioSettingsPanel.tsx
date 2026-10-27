import {
  Activity,
  AudioLines,
  Ear,
  Headphones,
  Mic,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { audioEngine } from '../../lib/audio/engine';
import { listInputDevices, onMediaDevicesChanged } from '../../lib/audio/devices';
import type {
  AecMode,
  AnsModel,
  AudioInputDevice,
  AudioMetrics,
} from '../../lib/audio/types';
import { setPrefs, usePrefs } from '../../lib/prefs';
import { useChatStore } from '../../lib/store';
import { voiceClient } from '../../lib/rtc';

const ANS_MODELS: {
  value: AnsModel;
  label: string;
  hint: string;
  icon: typeof AudioLines;
}[] = [
  {
    value: 'rnnoise',
    label: 'RNNoise',
    hint: '持续噪声 · 风扇 / 空调',
    icon: AudioLines,
  },
  {
    value: 'deepfilternet3',
    label: 'DeepFilterNet3',
    hint: '瞬时噪声 · 键盘 / 鼠标',
    icon: Activity,
  },
  {
    value: 'hush',
    label: 'Hush 预设',
    hint: '多人声 · DFN3 强隔离',
    icon: Sparkles,
  },
  {
    value: 'off',
    label: '关闭',
    hint: '只保留 AEC / AGC',
    icon: SlidersHorizontal,
  },
];

function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export default function AudioSettingsPanel({
  active,
  onClose,
}: {
  active: boolean;
  onClose: () => void;
}) {
  const prefs = usePrefs();
  const voiceInChannel = useChatStore((state) => state.voice.channelId !== null);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [state, setState] = useState(() => audioEngine.currentState);
  const [metrics, setMetrics] = useState<AudioMetrics>(() => state.metrics);

  useEffect(() => {
    const stop = audioEngine.onState((next) => {
      setState(next);
      setMetrics(next.metrics);
    });
    const stopMetrics = audioEngine.onMetrics(setMetrics);
    return () => {
      stop();
      stopMetrics();
    };
  }, []);

  useEffect(() => {
    void listInputDevices().then(setDevices);
    return onMediaDevicesChanged(() => {
      void listInputDevices().then(setDevices);
      if (voiceInChannel) void audioEngine.refreshOutput();
    });
  }, [voiceInChannel]);

  function apply(patch: Partial<typeof prefs.audio>): void {
    const next = { ...prefs.audio, ...patch };
    setPrefs({ audio: next });
    if (active && voiceInChannel) {
      void voiceClient.updateAudioSettings();
    }
  }

  const aecOptions: { value: AecMode; label: string }[] = [
    { value: 'auto', label: '自动' },
    { value: 'on', label: '开启' },
    { value: 'off', label: '关闭' },
  ];

  const outputKind = state.outputKind;
  const outputLabel = state.outputLabel || '系统默认输出';

  return (
    <div className="absolute bottom-full right-0 z-40 mb-3 w-[min(92vw,440px)] overflow-hidden rounded-2xl border border-white/10 bg-base-900/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-mist-100">
            <AudioLines size={16} className="text-mint-400" />
            音频处理
          </p>
          <p className="mt-0.5 text-[11px] text-mist-500">
            AEC 会根据输出设备自动调整；降噪与 AGC 在 AudioWorklet 中实时运行。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist-400 transition hover:bg-white/5 hover:text-white"
          aria-label="关闭音频设置"
        >
          <X size={16} />
        </button>
      </div>

      <div className="thin-scrollbar max-h-[min(70vh,620px)] space-y-4 overflow-y-auto p-4">
        <section>
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-mist-500">
            <Mic size={12} /> 麦克风
          </label>
          <select
            value={prefs.audio.micDeviceId}
            onChange={(event) => apply({ micDeviceId: event.target.value })}
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-base-950/60 px-3 text-xs text-mist-200 outline-none focus:border-mint-400/40"
          >
            <option value="">系统默认麦克风</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-xl border border-white/[0.06] bg-base-950/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-mist-200">
              <ShieldCheck size={14} className="text-mint-400" /> 回声抑制 (AEC)
            </p>
            <div className="flex gap-1">
              {aecOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => apply({ aecMode: option.value })}
                  className={`rounded-lg px-2 py-1 text-[10px] transition ${
                    prefs.audio.aecMode === option.value
                      ? 'bg-mint-400/15 text-mint-300'
                      : 'text-mist-500 hover:bg-white/5 hover:text-mist-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            {outputKind === 'headphones' ? (
              <Headphones size={13} className="text-mint-400" />
            ) : (
              <Volume2 size={13} className="text-accent-300" />
            )}
            <span className="min-w-0 flex-1 truncate text-mist-500" title={outputLabel}>
              {outputLabel}
            </span>
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                state.aecEnabled
                  ? 'border-mint-400/20 bg-mint-400/10 text-mint-400'
                  : 'border-warn-400/20 bg-warn-400/10 text-warn-400'
              }`}
            >
              {state.aecEnabled ? 'AEC ON' : 'AEC OFF'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[10px]">
            <span className="text-mist-600">输出类型</span>
            {[
              { value: 'auto' as const, label: '自动' },
              { value: 'headphones' as const, label: '耳机' },
              { value: 'speakers' as const, label: '扬声器' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => apply({ outputOverride: option.value })}
                className={`rounded-md px-1.5 py-0.5 transition ${
                  prefs.audio.outputOverride === option.value
                    ? 'bg-white/10 text-mist-200'
                    : 'text-mist-600 hover:text-mist-400'
                }`}
                title="有些 USB / 蓝牙耳机在 Windows 里会被报告为“扬声器”，可以在这里手动指定"
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-mist-600">{state.aecReason}</p>
          {metrics.echoLikelihood > 0.55 && prefs.audio.aecMode === 'off' && (
            <p className="mt-1 text-[10px] text-warn-400">
              检测到麦克风与播放声音重合度较高（{(metrics.echoLikelihood * 100).toFixed(0)}%），建议开启 AEC。
            </p>
          )}
        </section>

        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-mist-500">
            <Ear size={12} /> 噪声抑制 (ANS)
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ANS_MODELS.map((model) => {
              const Icon = model.icon;
              const selected = prefs.audio.ansModel === model.value;
              return (
                <button
                  key={model.value}
                  type="button"
                  onClick={() => apply({ ansModel: model.value })}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    selected
                      ? 'border-mint-400/40 bg-mint-400/10'
                      : 'border-white/[0.06] bg-base-950/40 hover:border-white/15'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-mist-100">
                    <Icon size={14} className={selected ? 'text-mint-400' : 'text-mist-500'} />
                    {model.label}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-mist-500">
                    {model.hint}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-mist-600">
            RNNoise / DeepFilterNet3 使用 WASM 模型；Hush 预设使用 DeepFilterNet3 的强语音隔离参数，
            适合多人背景声环境。
          </p>
          {state.running && state.ansLoading && (
            <p className="mt-1 text-[10px] text-mist-500">
              降噪模型正在后台加载，当前先用原始麦克风 + VAD/AGC。
            </p>
          )}
          {state.running &&
            !state.ansLoading &&
            !state.ansAvailable &&
            prefs.audio.ansModel !== 'off' && (
              <p className="mt-1 text-[10px] text-warn-400">
                降噪模型没有加载成功，当前使用原始麦克风 + VAD/AGC。请检查服务器是否提供
                /audio 资源。
              </p>
            )}
        </section>

        <section className="space-y-3 rounded-xl border border-white/[0.06] bg-base-950/40 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-xs font-medium text-mist-200">音量自适应 (AGC)</span>
              <span className="mt-0.5 block text-[10px] text-mist-500">
                目标 -20 dBFS，带软限幅，避免忽大忽小。
              </span>
            </span>
            <input
              type="checkbox"
              checked={prefs.audio.agc}
              onChange={(event) => apply({ agc: event.target.checked })}
              className="h-4 w-4 accent-mint-400"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-xs font-medium text-mist-200">VAD 静音门</span>
              <span className="mt-0.5 block text-[10px] text-mist-500">
                低于阈值时门限衰减，并配合 Opus DTX 停止发包。
              </span>
            </span>
            <input
              type="checkbox"
              checked={prefs.audio.gate}
              onChange={(event) => apply({ gate: event.target.checked })}
              className="h-4 w-4 accent-mint-400"
            />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] text-mist-500">
              <span>VAD 阈值</span>
              <span>{prefs.audio.vadThresholdDb} dB above floor</span>
            </div>
            <input
              type="range"
              min={2}
              max={20}
              step={1}
              value={prefs.audio.vadThresholdDb}
              onChange={(event) =>
                apply({ vadThresholdDb: Number(event.target.value) })
              }
              className="h-1.5 w-full accent-mint-400"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] text-mist-500">
              <span className="flex items-center gap-1">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    metrics.vad ? 'bg-mint-400' : 'bg-mist-600'
                  }`}
                />
                {metrics.vad ? '检测到语音' : '静音'}
              </span>
              <span>
                {metrics.levelDb <= -99 ? '-∞' : metrics.levelDb.toFixed(0)} dBFS · 噪声底{' '}
                {metrics.noiseFloorDb.toFixed(0)}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-base-800">
              <div
                className={`h-full rounded-full transition-[width] duration-100 ${
                  metrics.vad
                    ? 'bg-gradient-to-r from-mint-400/60 to-mint-400'
                    : 'bg-mist-600/70'
                }`}
                style={{ width: `${dbToPercent(metrics.levelDb)}%` }}
              />
              <div
                className="absolute inset-y-0 w-px bg-warn-400/70"
                style={{ left: `${dbToPercent(metrics.noiseFloorDb + prefs.audio.vadThresholdDb)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-mist-600">
              <span>AEC 回声重合 {Math.round(metrics.echoLikelihood * 100)}%</span>
              <span>AGC {metrics.gainDb >= 0 ? '+' : ''}{metrics.gainDb.toFixed(1)} dB</span>
            </div>
          </div>
        </section>
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2 text-[10px] text-mist-600">
        {voiceInChannel
          ? '设置会立即应用到当前通话'
          : '设置会在下次加入语音频道时生效'}
      </div>
    </div>
  );
}
