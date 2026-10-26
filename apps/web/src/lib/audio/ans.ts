import type { AnsModel } from './types';

export interface AnsProcessor {
  readonly track: MediaStreamTrack;
  setModel(model: AnsModel): Promise<void>;
  restart(audioContext: AudioContext, track: MediaStreamTrack): Promise<void>;
  dispose(): Promise<void>;
}

const WORKLET_URL = '/audio/AudioPipelineWorklet.js';
const WORKER_URL = '/audio/AudioPipelineWorker.js';
const RNNOISE_WASM = '/audio/rnnoise.wasm';
const DEEPFILTER_WASM = '/audio/deepfilter.wasm';

const DEEPFILTER_CONFIG = {
  attenLimDb: 100,
  postFilterBeta: 0,
};

// DeepFilterNet with a more aggressive speech-isolation setting. This is the
// closest browser-side match for Hush's background-speaker suppression; when a
// native Hush WASM bundle is dropped into /audio/hush.wasm this adapter can be
// pointed at it without changing the rest of the audio graph.
const HUSH_CONFIG = {
  attenLimDb: 100,
  postFilterBeta: 0.05,
  minDbThresh: -20,
  maxDbErbThresh: 20,
  maxDbDfThresh: 20,
};

function stageModel(model: AnsModel): 'rnnoise' | 'deepfilternet' {
  return model === 'rnnoise' ? 'rnnoise' : 'deepfilternet';
}

export async function createAnsProcessor(
  audioContext: AudioContext,
  track: MediaStreamTrack,
  model: AnsModel,
): Promise<AnsProcessor | null> {
  if (model === 'off') return null;

  try {
    const { AudioPipelineTrackProcessor } = await import(
      '@cc-livekit/audio-pipeline-plugin'
    );
    const processor = new AudioPipelineTrackProcessor({
      workletUrl: WORKLET_URL,
      workerUrl: WORKER_URL,
      wasmUrls: {
        rnnoise: RNNOISE_WASM,
        deepfilter: DEEPFILTER_WASM,
      },
      batchFrames: 1,
      debugLogs: false,
      stages: { denoise: stageModel(model) },
      moduleConfigs: {
        rnnoise: {},
        deepfilternet: model === 'hush' ? HUSH_CONFIG : DEEPFILTER_CONFIG,
        soundtouch: { enabled: false },
      },
    } as never);

    await processor.init({ audioContext, track } as never);
    const processed = processor.processedTrack;
    if (!processed) throw new Error('The denoiser did not produce a track');

    let current: AnsModel = model;
    await applyModel(processor, model);

    return {
      track: processed,
      async setModel(next) {
        if (next === current) return;
        if (next === 'off') {
          await processor.setDenoiseEnabled(false);
        } else {
          await processor.setDenoiseEnabled(true);
          await applyModel(processor, next);
        }
        current = next;
      },
      async restart(ctx, nextTrack) {
        await processor.restart({ audioContext: ctx, track: nextTrack } as never);
      },
      async dispose() {
        await processor.destroy();
      },
    };
  } catch (error) {
    console.warn('[audio] noise suppression is unavailable', error);
    return null;
  }
}

async function applyModel(
  processor: {
    setStageModule: (stage: 'denoise', module: 'rnnoise' | 'deepfilternet') => Promise<void>;
    setModuleConfig: {
      (module: 'rnnoise', config: Record<string, unknown>): Promise<void>;
      (module: 'deepfilternet', config: Record<string, unknown>): Promise<void>;
    };
  },
  model: Exclude<AnsModel, 'off'>,
): Promise<void> {
  if (model === 'rnnoise') {
    await processor.setStageModule('denoise', 'rnnoise');
    await processor.setModuleConfig('rnnoise', { vadLogs: false });
    return;
  }
  await processor.setStageModule('denoise', 'deepfilternet');
  await processor.setModuleConfig(
    'deepfilternet',
    model === 'hush' ? HUSH_CONFIG : DEEPFILTER_CONFIG,
  );
}
