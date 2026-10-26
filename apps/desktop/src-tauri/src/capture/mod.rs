mod audio;
mod stream;
mod wgc;

use crate::types::CaptureInfo;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch};

#[derive(Debug, Clone)]
pub enum CapturePacket {
    Video(Vec<u8>),
    Audio(Vec<u8>),
    End,
}

pub struct CaptureSession {
    pub stop: Arc<AtomicBool>,
}

impl CaptureSession {
    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureSource {
    #[default]
    Screen,
    Window,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMeta {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub hdr: bool,
    pub format: String,
    pub audio: bool,
    pub audio_sample_rate: u32,
    pub audio_channels: u32,
}

pub fn quality_size(quality: Option<&str>) -> (u32, u32) {
    match quality.unwrap_or("900p") {
        "720p" => (1280, 720),
        "1080p" => (1920, 1080),
        _ => (1600, 900),
    }
}

pub async fn start_capture(
    hdr: bool,
    source: CaptureSource,
    max_size: (u32, u32),
) -> Result<Option<(CaptureInfo, CaptureSession)>, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("无法启动本地采集通道：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("无法读取采集端口：{error}"))?
        .port();
    let token = format!(
        "{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    );

    let stop = Arc::new(AtomicBool::new(false));
    let (packet_tx, _) = broadcast::channel::<Arc<CapturePacket>>(48);
    let (meta_tx, meta_rx) = watch::channel::<Option<CaptureMeta>>(None);
    let connected = Arc::new(AtomicBool::new(false));

    let packet_rx = packet_tx.subscribe();
    let ws_token = token.clone();
    let ws_stop = stop.clone();
    let ws_connected = connected.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = stream::serve(
            listener,
            ws_token,
            meta_rx,
            packet_rx,
            ws_stop,
            ws_connected,
        )
        .await
        {
            eprintln!("[capture] websocket ended: {error}");
        }
    });

    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Option<(u32, u32)>>();
    let capture_stop = stop.clone();
    let capture_packets = packet_tx.clone();
    std::thread::Builder::new()
        .name("nebula-wgc".to_string())
        .spawn(move || {
            wgc::run(
                hdr,
                source,
                max_size,
                capture_packets,
                meta_tx,
                capture_stop,
                ready_tx,
            );
        })
        .map_err(|error| format!("无法启动屏幕采集线程：{error}"))?;

    let dimensions = match tokio::time::timeout(Duration::from_secs(180), ready_rx).await {
        Ok(Ok(Some(size))) => size,
        Ok(Ok(None)) => {
            stop.store(true, Ordering::SeqCst);
            return Ok(None);
        }
        Ok(Err(_)) => {
            stop.store(true, Ordering::SeqCst);
            return Err("屏幕采集线程提前退出".to_string());
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            return Err("等待屏幕选择超时".to_string());
        }
    };

    // If the webview never connects, do not leave a capture session running.
    let timeout_stop = stop.clone();
    let timeout_connected = connected.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        if !timeout_connected.load(Ordering::SeqCst) {
            timeout_stop.store(true, Ordering::SeqCst);
        }
    });

    Ok(Some((
        CaptureInfo {
            ws_url: format!("ws://127.0.0.1:{port}/capture"),
            token,
            width: dimensions.0,
            height: dimensions.1,
            fps: 30,
            hdr,
            audio: true,
        },
        CaptureSession { stop },
    )))
}
