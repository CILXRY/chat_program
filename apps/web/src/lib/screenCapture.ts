const FORCE_SDR_KEY = 'nebula.forceSdrScreenCapture';

/** CSS media query is the most reliable browser-side HDR display signal. */
export function isHdrDisplay(): boolean {
  try {
    return window.matchMedia('(dynamic-range: high)').matches;
  } catch {
    return false;
  }
}

export function readForceSdr(): boolean {
  try {
    return window.localStorage.getItem(FORCE_SDR_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeForceSdr(value: boolean): void {
  try {
    window.localStorage.setItem(FORCE_SDR_KEY, value ? '1' : '0');
  } catch {
    // localStorage can be unavailable in strict privacy modes.
  }
}

/**
 * Draws a captured screen track into an SDR canvas and re-captures it.
 *
 * Chrome's 2D canvas performs the HDR -> SDR tone mapping when HDR frames are
 * drawn into an sRGB canvas. WebRTC only carries SDR here, so normalizing at
 * the source avoids sending PQ/Rec.2020 frames that receivers would interpret
 * as BT.709 (washed-out colors).
 */
export class SdrScreenPipeline {
  private readonly raw: MediaStream;
  private readonly fps: number;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null = null;
  private output: MediaStream | null = null;
  private streamValue: MediaStream | null = null;
  private frameCallback: number | null = null;
  private timer: number | null = null;
  private lastDraw = 0;
  private stopped = false;

  constructor(raw: MediaStream, fps = 30) {
    this.raw = raw;
    this.fps = fps;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    this.canvas = document.createElement('canvas');
  }

  get stream(): MediaStream | null {
    return this.streamValue;
  }

  async start(): Promise<boolean> {
    try {
      document.body.appendChild(this.video);
      this.video.srcObject = this.raw;
      await this.video.play();

      if (!this.video.videoWidth || !this.video.videoHeight) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error('Timed out waiting for the screen size')),
            4000,
          );
          this.video.addEventListener(
            'loadedmetadata',
            () => {
              window.clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }

      const width = this.video.videoWidth;
      const height = this.video.videoHeight;
      if (!width || !height) {
        throw new Error('The screen track has no dimensions');
      }

      this.canvas.width = width;
      this.canvas.height = height;
      this.context = this.canvas.getContext('2d', {
        alpha: false,
        colorSpace: 'srgb',
        desynchronized: true,
      });
      if (!this.context) {
        throw new Error('2D canvas is unavailable');
      }

      this.context.drawImage(this.video, 0, 0, width, height);
      this.output = this.canvas.captureStream(this.fps);
      const outputVideo = this.output.getVideoTracks()[0];
      if (!outputVideo) {
        throw new Error('Canvas capture produced no video track');
      }
      outputVideo.contentHint = 'detail';
      this.streamValue = new MediaStream([
        outputVideo,
        ...this.raw.getAudioTracks(),
      ]);
      this.schedule();
      return true;
    } catch (error) {
      console.warn('[screen] SDR tone mapping unavailable, using raw capture', error);
      this.cleanupRendering();
      this.output?.getTracks().forEach((track) => track.stop());
      this.output = null;
      this.streamValue = null;
      // Keep the raw capture alive: the caller can fall back to it.
      return false;
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanupRendering();
    this.output?.getTracks().forEach((track) => track.stop());
    this.output = null;
    this.streamValue = null;
    this.raw.getTracks().forEach((track) => track.stop());
  }

  private cleanupRendering(): void {
    if (this.frameCallback !== null) {
      this.video.cancelVideoFrameCallback(this.frameCallback);
      this.frameCallback = null;
    }
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
  }

  private schedule(): void {
    if (this.stopped) return;
    if ('requestVideoFrameCallback' in this.video) {
      this.frameCallback = this.video.requestVideoFrameCallback((now) => {
        this.draw(now);
        this.schedule();
      });
      return;
    }
    this.timer = window.setTimeout(
      () => {
        this.draw(performance.now());
        this.schedule();
      },
      Math.max(1, Math.round(1000 / this.fps)),
    );
  }

  private draw(now: number): void {
    if (this.stopped || !this.context) return;
    const minInterval = 1000 / this.fps;
    if (now - this.lastDraw < minInterval - 2) return;
    this.lastDraw = now;
    this.context.drawImage(
      this.video,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
  }
}
