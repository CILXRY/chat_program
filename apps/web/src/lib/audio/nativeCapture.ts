export interface CaptureInfo {
  wsUrl: string;
  token: string;
  width: number;
  height: number;
  fps: number;
  hdr: boolean;
  audio: boolean;
}

interface CaptureMeta {
  width: number;
  height: number;
  fps: number;
  hdr: boolean;
  format: 'i420';
  audio: boolean;
  audioSampleRate: number;
  audioChannels: number;
}

export interface NativeCaptureSession {
  stream: MediaStream;
  info: CaptureInfo;
  meta: CaptureMeta;
  onEnded?: () => void;
  stop(): Promise<void>;
}

export type NativeCaptureSource = 'screen' | 'window';
export type NativeScreenQuality = '720p' | '900p' | '1080p';

declare global {
  interface Window {
    MediaStreamTrackGenerator?: new (init: { kind: 'audio' | 'video' }) => MediaStreamTrack & {
      writable: WritableStream<VideoFrame>;
    };
  }
}

const META_TIMEOUT_MS = 30_000;

export function isNativeCaptureAvailable(): boolean {
  return Boolean(window.__TAURI__?.core?.invoke) && typeof WebSocket !== 'undefined';
}

/**
 * Opens the native Windows Graphics Capture picker and bridges the encoded
 * WGC frames into a real MediaStreamTrack that WebRTC can publish.
 *
 * The Rust side already tone-maps HDR FP16 frames to SDR and downscales to at
 * most 1920x1080, so the webview only has to decode JPEG frames. System audio
 * arrives on the same loopback WebSocket as 48 kHz stereo PCM.
 */
export async function startNativeCapture(
  hdr: boolean,
  source: NativeCaptureSource = 'screen',
  quality: NativeScreenQuality = '900p',
): Promise<NativeCaptureSession | null> {
  if (!isNativeCaptureAvailable()) return null;
  const info = await window.__TAURI__!.core!.invoke<CaptureInfo | null>('capture_start', {
    hdr,
    source,
    quality,
  });
  if (!info) return null;

  const socket = new WebSocket(info.wsUrl);
  socket.binaryType = 'arraybuffer';

  let closed = false;
  let videoWriter: WritableStreamDefaultWriter<VideoFrame> | null = null;
  let writing = 0;
  let audioContext: AudioContext | null = null;
  let audioNode: AudioWorkletNode | null = null;
  let videoTrack: MediaStreamTrack | null = null;
  let audioTrack: MediaStreamTrack | null = null;

  const meta = await new Promise<CaptureMeta>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('等待原生屏幕采集超时')),
      META_TIMEOUT_MS,
    );
    socket.onopen = () => socket.send(JSON.stringify({ token: info.token }));
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('无法连接原生采集通道'));
    };
    socket.onclose = () => {
      window.clearTimeout(timer);
      reject(new Error('原生屏幕采集已取消'));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const parsed = JSON.parse(event.data) as CaptureMeta & { type?: string };
        if (parsed.type === 'meta' || typeof parsed.width === 'number') {
          window.clearTimeout(timer);
          resolve(parsed);
        }
      } catch {
        // Ignore malformed control frames.
      }
    };
  }).catch(async (error) => {
    socket.close();
    await window.__TAURI__?.core?.invoke('capture_stop');
    throw error;
  });

  const canvasSink = createCanvasSink(meta.width, meta.height, meta.fps);
  videoTrack = canvasSink.track;
  // Prefer MediaStreamTrackGenerator when available: it avoids a canvas
  // readback and lets WebRTC consume VideoFrames directly.
  if (window.MediaStreamTrackGenerator) {
    try {
      const generator = new window.MediaStreamTrackGenerator({ kind: 'video' });
      videoWriter = generator.writable.getWriter();
      videoTrack = generator;
      canvasSink.dispose();
    } catch {
      videoWriter = null;
    }
  }

  if (info.audio) {
    try {
      audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await audioContext.resume();
      await audioContext.audioWorklet.addModule('/audio/pcm-bridge.js');
      audioNode = new AudioWorkletNode(audioContext, 'pcm-bridge', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      const destination = audioContext.createMediaStreamDestination();
      audioNode.connect(destination);
      audioTrack = destination.stream.getAudioTracks()[0] ?? null;
    } catch (error) {
      console.warn('[capture] system audio bridge unavailable', error);
      audioContext?.close().catch(() => undefined);
      audioContext = null;
      audioNode = null;
      audioTrack = null;
    }
  }

  socket.onmessage = (event) => {
    if (typeof event.data === 'string') return;
    const buffer = event.data as ArrayBuffer;
    if (buffer.byteLength < 1) return;
    const view = new DataView(buffer);
    const kind = view.getUint8(0);
    if (kind === 1) {
      const timestamp = view.getUint32(1, true) * 1000;
      void deliverVideo(buffer.slice(5), timestamp);
    } else if (kind === 2) {
      const pcm = new Int16Array(buffer.slice(1));
      audioNode?.port.postMessage({ type: 'pcm', samples: pcm }, [pcm.buffer]);
    }
  };

  socket.onclose = () => {
    if (closed) return;
    closed = true;
    videoWriter?.close().catch(() => undefined);
    videoWriter = null;
    canvasSink.dispose();
    session.onEnded?.();
  };

  async function deliverVideo(i420: ArrayBuffer, timestamp: number): Promise<void> {
    if (closed) return;
    if (writing > 2) return; // Drop frames instead of building a latency queue.
    writing += 1;
    try {
      const frame = new VideoFrame(i420, {
        format: 'I420',
        codedWidth: meta.width,
        codedHeight: meta.height,
        timestamp,
        colorSpace: {
          primaries: 'bt709',
          transfer: 'bt709',
          matrix: 'bt709',
          fullRange: false,
        },
      });
      if (videoWriter) {
        await videoWriter.write(frame);
        frame.close();
      } else {
        const bitmap = await createImageBitmap(frame);
        canvasSink.draw(bitmap, timestamp);
        bitmap.close();
        frame.close();
      }
    } catch (error) {
      console.warn('[capture] frame decode failed', error);
    } finally {
      writing = Math.max(0, writing - 1);
    }
  }

  if (videoTrack) videoTrack.contentHint = 'detail';
  const stream = new MediaStream();
  if (videoTrack) stream.addTrack(videoTrack);
  if (audioTrack) stream.addTrack(audioTrack);
  if (!videoTrack) {
    socket.close();
    await window.__TAURI__?.core?.invoke('capture_stop');
    throw new Error('原生屏幕采集没有生成视频轨道');
  }

  const session: NativeCaptureSession = {
    stream,
    info,
    meta,
    async stop() {
      const wasClosed = closed;
      closed = true;
      session.onEnded = undefined;
      if (!wasClosed) {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      }
      videoWriter?.close().catch(() => undefined);
      videoWriter = null;
      canvasSink.dispose();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);
      audioContext = null;
      audioNode = null;
      await window.__TAURI__?.core?.invoke('capture_stop');
    },
  };

  return session;
}

function createCanvasSink(width: number, height: number, fps: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, width);
  canvas.height = Math.max(2, height);
  const context = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
  });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  let disposed = false;

  return {
    track: track ?? null,
    draw(bitmap: ImageBitmap, _timestamp: number) {
      if (disposed) return;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      track?.requestFrame?.();
    },
    dispose() {
      disposed = true;
      track?.stop();
    },
  };
}
