import { createAnsProcessor, type AnsProcessor } from './ans';
import { detectOutputInfo } from './devices';
import {
  EMPTY_AUDIO_METRICS,
  type AecMode,
  type AnsModel,
  type AudioMetrics,
  type AudioOutputInfo,
  type AudioPrefs,
  type OutputKind,
} from './types';

const WORKLET_URL = '/audio/nebula-dsp.js';

type MetricsListener = (metrics: AudioMetrics) => void;
type StateListener = (state: AudioEngineState) => void;

export interface AudioEngineState {
  running: boolean;
  aecEnabled: boolean;
  aecReason: string;
  outputKind: OutputKind;
  outputLabel: string;
  ansModel: AnsModel;
  ansAvailable: boolean;
  ansLoading: boolean;
  metrics: AudioMetrics;
}

const INITIAL_STATE: AudioEngineState = {
  running: false,
  aecEnabled: true,
  aecReason: '尚未加入语音',
  outputKind: 'unknown',
  outputLabel: '',
  ansModel: 'rnnoise',
  ansAvailable: true,
  ansLoading: false,
  metrics: EMPTY_AUDIO_METRICS,
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms)),
  ]);
}

function aecSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

class AudioEngine {
  private context: AudioContext | null = null;
  private dsp: AudioWorkletNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sourceStream: MediaStream | null = null;
  private referenceGain: GainNode | null = null;
  private references = new Map<string, MediaStreamAudioSourceNode>();
  private rawStream: MediaStream | null = null;
  private pipeline: AnsProcessor | null = null;
  private finalTrack: MediaStreamTrack | null = null;
  private finalStream: MediaStream | null = null;
  private fallback = false;
  private prefs: AudioPrefs | null = null;
  private muted = false;
  private output: AudioOutputInfo = { kind: 'unknown', label: '', detected: false };
  private aecEnabled = true;
  private echoFrames = 0;
  private echoCooldownUntil = 0;
  private state: AudioEngineState = INITIAL_STATE;
  private metricsListeners = new Set<MetricsListener>();
  private stateListeners = new Set<StateListener>();
  private ansGeneration = 0;

  get stream(): MediaStream | null {
    return this.finalStream;
  }

  get track(): MediaStreamTrack | null {
    return this.finalTrack;
  }

  get currentState(): AudioEngineState {
    return this.state;
  }

  onMetrics(listener: MetricsListener): () => void {
    this.metricsListeners.add(listener);
    return () => this.metricsListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  async start(prefs: AudioPrefs): Promise<MediaStream | null> {
    if (this.context && this.finalStream) {
      this.prefs = prefs;
      return this.finalStream;
    }
    if (!aecSupported()) return null;

    this.prefs = prefs;
    try {
      this.context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await this.context.resume();
      await this.context.audioWorklet.addModule(WORKLET_URL);

      this.dsp = new AudioWorkletNode(this.context, 'nebula-dsp', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: {
          vadThresholdDb: prefs.vadThresholdDb,
          agcEnabled: prefs.agc,
          gateEnabled: prefs.gate,
        },
      });
      this.dsp.port.onmessage = (event) => this.onWorkletMessage(event);

      this.destination = this.context.createMediaStreamDestination();
      this.dsp.connect(this.destination);

      this.referenceGain = this.context.createGain();
      this.referenceGain.gain.value = 0.35;
      this.referenceGain.connect(this.dsp, 0, 1);

      // Ask for the microphone first; browsers hide output-device labels until
      // the user has granted media permission, which is what headphone
      // detection relies on.
      this.aecEnabled = prefs.aecMode !== 'off';
      this.rawStream = await this.openMic(prefs.micDeviceId, this.aecEnabled);
      this.output = await this.resolveOutput(prefs);
      const desiredAec = this.resolveAec(prefs.aecMode, this.output.kind, 0);
      if (desiredAec !== this.aecEnabled) {
        await this.restartMic(prefs.micDeviceId, desiredAec);
      }

      // Do not block the call on the 18 MB noise-suppression model. Start with
      // the raw microphone + VAD/AGC, then rewire to the denoised track when
      // the worker is ready.
      this.rewireSource();

      this.finalTrack = this.destination.stream.getAudioTracks()[0] ?? null;
      this.finalStream = this.destination.stream;
      this.setMuted(this.muted);
      this.updateState({
        running: true,
        aecEnabled: this.aecEnabled,
        aecReason: this.describeAecReason(prefs.aecMode, this.output.kind, this.aecEnabled),
        outputKind: this.output.kind,
        outputLabel: this.output.label,
        ansModel: prefs.ansModel,
        ansAvailable: prefs.ansModel === 'off',
        ansLoading: prefs.ansModel !== 'off',
      });

      if (prefs.ansModel !== 'off') {
        const generation = ++this.ansGeneration;
        void this.ensurePipeline(prefs.ansModel)
          .then(() => {
            if (generation !== this.ansGeneration) return;
            this.rewireSource();
            this.updateState({
              ansLoading: false,
              ansAvailable: Boolean(this.pipeline),
            });
          })
          .catch((error) => {
            if (generation !== this.ansGeneration) return;
            console.warn('[audio] noise suppression failed to load', error);
            this.updateState({ ansLoading: false, ansAvailable: false });
          });
      }

      return this.finalStream;
    } catch (error) {
      console.warn('[audio] falling back to the browser microphone', error);
      return this.startFallback(prefs);
    }
  }

  private async startFallback(prefs: AudioPrefs): Promise<MediaStream | null> {
    await this.disposeGraph();
    try {
      const stream = await withTimeout<MediaStream | null>(
        navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: prefs.micDeviceId ? { exact: prefs.micDeviceId } : undefined,
            echoCancellation: prefs.aecMode !== 'off',
            noiseSuppression: true,
            autoGainControl: prefs.agc,
            channelCount: 1,
          },
        }),
        8_000,
        null,
      );
      if (!stream) return null;
      this.rawStream = stream;
      this.finalStream = stream;
      this.finalTrack = stream.getAudioTracks()[0] ?? null;
      this.fallback = true;
      this.setMuted(this.muted);
      this.updateState({
        running: true,
        aecEnabled: prefs.aecMode !== 'off',
        aecReason: '浏览器原生音频链',
        outputKind: this.output.kind,
        outputLabel: this.output.label,
        ansModel: prefs.ansModel,
        ansAvailable: false,
        ansLoading: false,
      });
      return stream;
    } catch {
      return null;
    }
  }

  async stop(): Promise<void> {
    this.ansGeneration += 1;
    await this.disposeGraph();
    this.fallback = false;
    this.muted = false;
    this.prefs = null;
    this.updateState({
      ...INITIAL_STATE,
      metrics: EMPTY_AUDIO_METRICS,
    });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.finalTrack) this.finalTrack.enabled = !muted;
  }

  async applyPreferences(prefs: AudioPrefs): Promise<void> {
    const previous = this.prefs;
    this.prefs = prefs;
    if (this.fallback || !this.context || !this.rawStream) {
      if (prefs.ansModel !== previous?.ansModel) {
        // A full restart is required to change the native fallback chain.
        const wasMuted = this.muted;
        await this.stop();
        await this.start(prefs);
        this.setMuted(wasMuted);
      }
      return;
    }

    if (this.dsp) {
      this.dsp.port.postMessage({
        type: 'config',
        config: {
          vadThresholdDb: prefs.vadThresholdDb,
          agcEnabled: prefs.agc,
          gateEnabled: prefs.gate,
          multiSpeaker: prefs.ansModel === 'hush',
        },
      });
    }

    if (prefs.ansModel !== previous?.ansModel) {
      await this.applyAnsModel(prefs.ansModel);
    }

    const output = await this.resolveOutput(prefs);
    this.output = output;
    const desiredAec = this.resolveAec(prefs.aecMode, output.kind, this.state.metrics.echoLikelihood);
    const deviceChanged = Boolean(
      previous &&
        (prefs.micDeviceId !== previous.micDeviceId || desiredAec !== this.aecEnabled),
    );

    if (!previous || deviceChanged) {
      await this.restartMic(prefs.micDeviceId, desiredAec);
    }

    this.updateState({
      aecEnabled: this.aecEnabled,
      aecReason: this.describeAecReason(prefs.aecMode, output.kind, this.aecEnabled),
      outputKind: output.kind,
      outputLabel: output.label,
      ansModel: prefs.ansModel,
      ansAvailable: Boolean(this.pipeline) || prefs.ansModel === 'off',
      ansLoading: prefs.ansModel !== 'off' && !this.pipeline,
    });
  }

  /** Refreshes headphone detection after a device change or OS default change. */
  async refreshOutput(): Promise<void> {
    if (!this.prefs || !this.context) return;
    await this.applyPreferences(this.prefs);
  }

  attachReference(key: string, stream: MediaStream): void {
    if (!this.context || !this.referenceGain) return;
    this.detachReference(key);
    if (stream.getAudioTracks().length === 0) return;
    try {
      const source = this.context.createMediaStreamSource(stream);
      source.connect(this.referenceGain);
      this.references.set(key, source);
    } catch (error) {
      console.warn('[audio] failed to attach playback reference', error);
    }
  }

  detachReference(key: string): void {
    const source = this.references.get(key);
    if (!source) return;
    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
    this.references.delete(key);
  }

  private async openMic(deviceId: string, echoCancellation: boolean): Promise<MediaStream> {
    const stream = await withTimeout<MediaStream | null>(
      navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
        },
      }),
      10_000,
      null,
    );
    if (!stream) throw new Error('等待麦克风权限超时');
    return stream;
  }

  private async ensurePipeline(model: AnsModel): Promise<void> {
    if (model === 'off') {
      if (this.pipeline) {
        await this.pipeline.dispose();
        this.pipeline = null;
      }
      return;
    }
    if (!this.context || !this.rawStream) return;
    const rawTrack = this.rawStream.getAudioTracks()[0];
    if (!rawTrack) return;
    if (this.pipeline) {
      await this.pipeline.setModel(model);
      return;
    }
    this.pipeline = await createAnsProcessor(this.context, rawTrack, model);
  }

  private async applyAnsModel(model: AnsModel): Promise<void> {
    const generation = ++this.ansGeneration;
    if (model === 'off') {
      const previous = this.pipeline;
      this.pipeline = null;
      await previous?.dispose();
      this.rewireSource();
      this.updateState({ ansModel: model, ansLoading: false, ansAvailable: true });
      return;
    }
    if (!this.pipeline) {
      this.updateState({ ansModel: model, ansLoading: true });
      await this.ensurePipeline(model);
      if (generation === this.ansGeneration) {
        this.rewireSource();
        this.updateState({
          ansLoading: false,
          ansAvailable: Boolean(this.pipeline),
        });
      }
      return;
    }
    await this.pipeline.setModel(model);
    this.updateState({ ansModel: model, ansLoading: false, ansAvailable: true });
  }

  private rewireSource(): void {
    if (!this.context || !this.dsp) return;
    const processed = this.pipeline?.track ?? this.rawStream?.getAudioTracks()[0];
    if (!processed) return;
    try {
      this.source?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.sourceStream = new MediaStream([processed]);
    this.source = this.context.createMediaStreamSource(this.sourceStream);
    this.source.connect(this.dsp);
  }

  private async restartMic(deviceId: string, echoCancellation: boolean): Promise<void> {
    if (!this.context) return;
    if (!this.context.state || this.context.state === 'closed') return;
    const previous = this.rawStream;
    try {
      const next = await this.openMic(deviceId, echoCancellation);
      const nextTrack = next.getAudioTracks()[0];
      if (!nextTrack) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      if (this.pipeline) {
        await this.pipeline.restart(this.context, nextTrack);
      }
      this.rawStream = next;
      this.aecEnabled = echoCancellation;
      this.rewireSource();
      previous?.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.warn('[audio] failed to restart the microphone', error);
    }
  }

  private async resolveOutput(prefs: AudioPrefs): Promise<AudioOutputInfo> {
    const detected = await withTimeout(
      detectOutputInfo(),
      1_500,
      { kind: 'unknown' as const, label: '', detected: false },
    );
    if (prefs.outputOverride === 'auto') return detected;
    return {
      kind: prefs.outputOverride,
      label: detected.label,
      detected: true,
    };
  }

  private resolveAec(mode: AecMode, kind: OutputKind, _echoLikelihood: number): boolean {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    if (kind === 'headphones') return false;
    if (kind === 'speakers') return true;
    // Unknown output: stay conservative. The correlation estimate is exposed
    // in the UI and can enable AEC if it was manually disabled, but we never
    // disable AEC purely from a correlation drop (that would oscillate while
    // the far-end echo path changes).
    return true;
  }

  private describeAecReason(mode: AecMode, kind: OutputKind, enabled: boolean): string {
    if (mode === 'on') return '已强制开启';
    if (mode === 'off') return '已强制关闭';
    if (kind === 'headphones') return '输出设备为耳机，AEC 已自动减弱';
    if (kind === 'speakers') return '输出设备为扬声器，AEC 已开启';
    return enabled ? '未能识别输出设备，保守开启 AEC' : '未识别输出设备，AEC 已关闭';
  }

  private onWorkletMessage(event: MessageEvent): void {
    const data = event.data as { type?: string; metrics?: AudioMetrics } | null;
    if (data?.type !== 'metrics' || !data.metrics) return;
    const metrics = data.metrics;
    this.updateState({ metrics });
    for (const listener of this.metricsListeners) listener(metrics);

    if (!this.prefs || this.prefs.aecMode !== 'auto') return;
    if (this.output.kind === 'headphones' || this.output.kind === 'speakers') return;
    if (metrics.echoLikelihood < 0.62 || this.aecEnabled) {
      this.echoFrames = 0;
      return;
    }
    this.echoFrames += 1;
    if (this.echoFrames < 8 || Date.now() < this.echoCooldownUntil) return;
    this.echoFrames = 0;
    this.echoCooldownUntil = Date.now() + 8000;
    void this.restartMic(this.prefs.micDeviceId, true).then(() => {
      this.updateState({
        aecEnabled: true,
        aecReason: '检测到回声重合，已自动开启 AEC',
      });
    });
  }

  private updateState(patch: Partial<AudioEngineState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.aecEnabled === this.state.aecEnabled &&
      next.aecReason === this.state.aecReason &&
      next.outputKind === this.state.outputKind &&
      next.outputLabel === this.state.outputLabel &&
      next.ansModel === this.state.ansModel &&
      next.ansAvailable === this.state.ansAvailable &&
      next.ansLoading === this.state.ansLoading &&
      next.running === this.state.running &&
      next.metrics === this.state.metrics
    ) {
      return;
    }
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  private async disposeGraph(): Promise<void> {
    const pipeline = this.pipeline;
    this.pipeline = null;
    await pipeline?.dispose().catch(() => undefined);
    for (const key of [...this.references.keys()]) this.detachReference(key);
    try {
      this.source?.disconnect();
      this.dsp?.disconnect();
      this.referenceGain?.disconnect();
    } catch {
      // Nodes may already be closed.
    }
    this.dsp?.port.close();
    this.dsp = null;
    this.source = null;
    this.sourceStream = null;
    this.referenceGain = null;
    this.destination = null;
    this.rawStream?.getTracks().forEach((track) => track.stop());
    this.rawStream = null;
    this.finalTrack = null;
    this.finalStream = null;
    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined);
    }
    this.context = null;
  }
}

export const audioEngine = new AudioEngine();
