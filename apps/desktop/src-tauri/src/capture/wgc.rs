use super::{CaptureMeta, CapturePacket};
use rayon::prelude::*;
use std::error::Error;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, oneshot, watch};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::graphics_capture_picker::GraphicsCapturePicker;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};

type HandlerError = Box<dyn Error + Send + Sync>;

struct WgcFlags {
    packets: broadcast::Sender<Arc<CapturePacket>>,
    stop: Arc<AtomicBool>,
    target: (u32, u32),
}

pub fn run(
    hdr: bool,
    source: super::CaptureSource,
    max_size: (u32, u32),
    packets: broadcast::Sender<Arc<CapturePacket>>,
    meta_tx: watch::Sender<Option<CaptureMeta>>,
    stop: Arc<AtomicBool>,
    ready_tx: oneshot::Sender<Option<(u32, u32)>>,
) {
    let packets_for_error = packets.clone();
    let stop_for_error = stop.clone();
    let (item, raw_width, raw_height) = match resolve_item(source) {
        Ok(Some(value)) => value,
        Ok(None) => {
            stop.store(true, Ordering::SeqCst);
            let _ = ready_tx.send(None);
            return;
        }
        Err(error) => {
            eprintln!("[capture] failed to select capture source: {error}");
            stop.store(true, Ordering::SeqCst);
            let _ = ready_tx.send(None);
            return;
        }
    };

    let (width, height) = fit(raw_width, raw_height, max_size.0, max_size.1);
    let meta = CaptureMeta {
        width,
        height,
        fps: 30,
        hdr,
        format: "i420".to_string(),
        audio: true,
        audio_sample_rate: 48_000,
        audio_channels: 2,
    };
    let _ = meta_tx.send(Some(meta));
    let _ = ready_tx.send(Some((width, height)));

    // WASAPI loopback runs alongside the Graphics Capture thread.
    let audio_packets = packets.clone();
    let audio_stop = stop.clone();
    let _ = std::thread::Builder::new()
        .name("nebula-wasapi-loopback".to_string())
        .spawn(move || super::audio::run(audio_packets, audio_stop));

    let flags = WgcFlags {
        packets,
        stop,
        target: (width, height),
    };
    let settings = Settings::new(
        item,
        CursorCaptureSettings::Default,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(33)),
        DirtyRegionSettings::Default,
        if hdr {
            ColorFormat::Rgba16F
        } else {
            ColorFormat::Bgra8
        },
        flags,
    );

    if let Err(error) = CaptureHandler::start(settings) {
        eprintln!("[capture] graphics capture failed: {error}");
        stop_for_error.store(true, Ordering::SeqCst);
        let _ = packets_for_error.send(Arc::new(CapturePacket::End));
    }
    let _ = meta_tx.send(None);
}

fn resolve_item(
    source: super::CaptureSource,
) -> Result<Option<(GraphicsCaptureItemType, u32, u32)>, Box<dyn std::error::Error + Send + Sync>> {
    match source {
        super::CaptureSource::Screen => {
            let monitor = Monitor::primary()?;
            let width = monitor.width()?;
            let height = monitor.height()?;
            Ok(Some((monitor.try_into()?, width, height)))
        }
        super::CaptureSource::Window => {
            let picked = GraphicsCapturePicker::pick_item()?;
            let Some(picked) = picked else {
                return Ok(None);
            };
            let (width, height) = picked.size()?;
            Ok(Some((
                picked.try_into()?,
                width.max(2) as u32,
                height.max(2) as u32,
            )))
        }
    }
}

fn fit(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    let even = |value: u32| ((value.max(2)) / 2 * 2).max(2);
    if width <= max_width && height <= max_height {
        return (even(width), even(height));
    }
    let scale = (max_width as f64 / width as f64).min(max_height as f64 / height as f64);
    (
        even((width as f64 * scale).round() as u32),
        even((height as f64 * scale).round() as u32),
    )
}

struct CaptureHandler {
    packets: broadcast::Sender<Arc<CapturePacket>>,
    stop: Arc<AtomicBool>,
    target: (u32, u32),
    start: Instant,
    last: Instant,
    frames: u64,
}

impl GraphicsCaptureApiHandler for CaptureHandler {
    type Flags = WgcFlags;
    type Error = HandlerError;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            packets: ctx.flags.packets,
            stop: ctx.flags.stop,
            target: ctx.flags.target,
            start: Instant::now(),
            last: Instant::now() - Duration::from_millis(100),
            frames: 0,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.stop.load(Ordering::SeqCst) {
            capture_control.stop();
            let _ = self.packets.send(Arc::new(CapturePacket::End));
            return Ok(());
        }
        self.frames += 1;
        if self.frames <= 2 || self.frames % 30 == 0 {
            eprintln!(
                "[capture] frame {} {}x{} {:?} t={:.2}s",
                self.frames,
                frame.width(),
                frame.height(),
                frame.color_format(),
                self.start.elapsed().as_secs_f64()
            );
        }
        if self.last.elapsed() < Duration::from_millis(30) {
            return Ok(());
        }
        self.last = Instant::now();

        let convert_started = Instant::now();
        let i420 = match frame_to_i420(frame, self.target.0, self.target.1, self.frames % 30 == 0) {
            Ok(data) => data,
            Err(error) => {
                eprintln!("[capture] frame conversion failed: {error}");
                return Ok(());
            }
        };
        if self.frames % 30 == 0 {
            eprintln!(
                "[capture] convert+pack {}ms, i420 {} KiB",
                convert_started.elapsed().as_millis(),
                i420.len() / 1024
            );
        }

        let mut packet = Vec::with_capacity(i420.len() + 5);
        packet.push(1);
        packet.extend_from_slice(&(self.start.elapsed().as_millis() as u32).to_le_bytes());
        packet.extend_from_slice(&i420);
        if self
            .packets
            .send(Arc::new(CapturePacket::Video(packet)))
            .is_err()
        {
            eprintln!("[capture] no websocket receiver for video");
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.packets.send(Arc::new(CapturePacket::End));
        Ok(())
    }
}

struct FrameSampler<'a> {
    raw: &'a [u8],
    row_pitch: usize,
    width: usize,
    height: usize,
    color: ColorFormat,
    lut: Option<&'static [u8]>,
}

impl FrameSampler<'_> {
    fn pixel(&self, x: usize, y: usize) -> (u8, u8, u8) {
        match self.color {
            ColorFormat::Bgra8 => {
                let index = y * self.row_pitch + x * 4;
                (self.raw[index + 2], self.raw[index + 1], self.raw[index])
            }
            ColorFormat::Rgba8 => {
                let index = y * self.row_pitch + x * 4;
                (self.raw[index], self.raw[index + 1], self.raw[index + 2])
            }
            ColorFormat::Rgba16F => {
                let index = y * self.row_pitch + x * 8;
                let lut = self.lut.unwrap_or(&[]);
                (
                    lut[lookup_half(self.raw, index, lut.len())],
                    lut[lookup_half(self.raw, index + 2, lut.len())],
                    lut[lookup_half(self.raw, index + 4, lut.len())],
                )
            }
        }
    }

    fn sample(
        &self,
        target_x: usize,
        target_y: usize,
        target_w: usize,
        target_h: usize,
    ) -> (u8, u8, u8) {
        let source_x = ((target_x as f32 + 0.5) * self.width as f32 / target_w as f32 - 0.5)
            .clamp(0.0, (self.width.saturating_sub(1)) as f32);
        let source_y = ((target_y as f32 + 0.5) * self.height as f32 / target_h as f32 - 0.5)
            .clamp(0.0, (self.height.saturating_sub(1)) as f32);
        let x0 = source_x.floor() as usize;
        let y0 = source_y.floor() as usize;
        let x1 = (x0 + 1).min(self.width.saturating_sub(1));
        let y1 = (y0 + 1).min(self.height.saturating_sub(1));
        let wx = source_x - x0 as f32;
        let wy = source_y - y0 as f32;

        let (r00, g00, b00) = self.pixel(x0, y0);
        let (r10, g10, b10) = self.pixel(x1, y0);
        let (r01, g01, b01) = self.pixel(x0, y1);
        let (r11, g11, b11) = self.pixel(x1, y1);

        let w00 = (1.0 - wx) * (1.0 - wy);
        let w10 = wx * (1.0 - wy);
        let w01 = (1.0 - wx) * wy;
        let w11 = wx * wy;

        (
            (r00 as f32 * w00 + r10 as f32 * w10 + r01 as f32 * w01 + r11 as f32 * w11)
                .round()
                .clamp(0.0, 255.0) as u8,
            (g00 as f32 * w00 + g10 as f32 * w10 + g01 as f32 * w01 + g11 as f32 * w11)
                .round()
                .clamp(0.0, 255.0) as u8,
            (b00 as f32 * w00 + b10 as f32 * w10 + b01 as f32 * w01 + b11 as f32 * w11)
                .round()
                .clamp(0.0, 255.0) as u8,
        )
    }
}

fn frame_to_i420(
    frame: &mut Frame,
    target_width: u32,
    target_height: u32,
    verbose: bool,
) -> Result<Vec<u8>, HandlerError> {
    let started = Instant::now();
    let width = frame.width();
    let height = frame.height();
    let color = frame.color_format();
    let mut buffer = frame.buffer()?;
    let row_pitch = buffer.row_pitch() as usize;
    let raw: &[u8] = buffer.as_raw_buffer();

    let tw = (target_width.max(2) & !1) as usize;
    let th = (target_height.max(2) & !1) as usize;
    let uv_w = tw / 2;
    let uv_h = th / 2;

    let mut y_plane = vec![0u8; tw * th];
    let mut u_plane = vec![0u8; uv_w * uv_h];
    let mut v_plane = vec![0u8; uv_w * uv_h];
    let sampler = FrameSampler {
        raw,
        row_pitch,
        width: width as usize,
        height: height as usize,
        color,
        lut: if matches!(color, ColorFormat::Rgba16F) {
            Some(tone_lut())
        } else {
            None
        },
    };

    y_plane
        .par_chunks_mut(tw * 2)
        .zip(u_plane.par_chunks_mut(uv_w))
        .zip(v_plane.par_chunks_mut(uv_w))
        .enumerate()
        .for_each(|(row_pair, ((y_rows, u_row), v_row))| {
            let mut rgb_rows = vec![0u8; tw * 2 * 3];
            for dy in 0..2 {
                for x in 0..tw {
                    let (r, g, b) = sampler.sample(x, row_pair * 2 + dy, tw, th);
                    let index = (dy * tw + x) * 3;
                    rgb_rows[index] = r;
                    rgb_rows[index + 1] = g;
                    rgb_rows[index + 2] = b;
                    y_rows[dy * tw + x] = rgb_to_y(r, g, b);
                }
            }

            for bx in 0..uv_w {
                let mut r_sum = 0u32;
                let mut g_sum = 0u32;
                let mut b_sum = 0u32;
                for dy in 0..2 {
                    for dx in 0..2 {
                        let x = bx * 2 + dx;
                        let index = (dy * tw + x) * 3;
                        r_sum += rgb_rows[index] as u32;
                        g_sum += rgb_rows[index + 1] as u32;
                        b_sum += rgb_rows[index + 2] as u32;
                    }
                }
                let r = (r_sum / 4) as f32;
                let g = (g_sum / 4) as f32;
                let b = (b_sum / 4) as f32;
                u_row[bx] = rgb_to_u(r, g, b);
                v_row[bx] = rgb_to_v(r, g, b);
            }
        });

    let mut output = Vec::with_capacity(y_plane.len() + u_plane.len() + v_plane.len());
    output.extend_from_slice(&y_plane);
    output.extend_from_slice(&u_plane);
    output.extend_from_slice(&v_plane);
    if verbose {
        eprintln!(
            "[capture] i420 {}x{} in {}ms",
            tw,
            th,
            started.elapsed().as_millis()
        );
    }
    Ok(output)
}

fn rgb_to_y(r: u8, g: u8, b: u8) -> u8 {
    let (r, g, b) = (r as f32, g as f32, b as f32);
    (16.0 + (65.481 * r + 128.553 * g + 24.966 * b) / 255.0)
        .round()
        .clamp(16.0, 235.0) as u8
}

fn rgb_to_u(r: f32, g: f32, b: f32) -> u8 {
    (128.0 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255.0)
        .round()
        .clamp(16.0, 240.0) as u8
}

fn rgb_to_v(r: f32, g: f32, b: f32) -> u8 {
    (128.0 + (112.0 * r - 93.786 * g - 18.214 * b) / 255.0)
        .round()
        .clamp(16.0, 240.0) as u8
}

fn lookup_half(bytes: &[u8], offset: usize, entries: usize) -> usize {
    let value = half::f16::from_le_bytes([bytes[offset], bytes[offset + 1]]).to_f32();
    let scaled = (value.max(0.0) / 4.0 * (entries - 1) as f32) as usize;
    scaled.min(entries - 1)
}

/// Pre-computes scRGB FP16 -> display-referred sRGB. The `powf` call is moved
/// out of the per-pixel loop, which matters at 1440p/4K HDR.
fn tone_lut() -> &'static [u8] {
    static LUT: OnceLock<Vec<u8>> = OnceLock::new();
    LUT.get_or_init(|| {
        const ENTRIES: usize = 16_384;
        let mut table = Vec::with_capacity(ENTRIES);
        for index in 0..ENTRIES {
            let linear = index as f32 / (ENTRIES - 1) as f32 * 4.0;
            table.push(linear_to_srgb(aces_tonemap(linear)));
        }
        table
    })
}

/// scRGB (linear, Rec.709 primaries) -> display-referred SDR.
fn aces_tonemap(value: f32) -> f32 {
    let x = value.max(0.0);
    (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
}

fn linear_to_srgb(value: f32) -> u8 {
    let x = value.clamp(0.0, 1.0);
    let encoded = if x <= 0.003_130_8 {
        12.92 * x
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    };
    (encoded * 255.0 + 0.5).clamp(0.0, 255.0) as u8
}
