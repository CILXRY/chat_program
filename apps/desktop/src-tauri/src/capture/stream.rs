use super::{CaptureMeta, CapturePacket};
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

pub async fn serve(
    listener: tokio::net::TcpListener,
    token: String,
    mut meta_rx: watch::Receiver<Option<CaptureMeta>>,
    mut packets: broadcast::Receiver<Arc<CapturePacket>>,
    stop: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
) -> Result<(), String> {
    let (tcp, _) = listener
        .accept()
        .await
        .map_err(|error| format!("accept failed: {error}"))?;
    let mut socket = tokio_tungstenite::accept_async(tcp)
        .await
        .map_err(|error| format!("websocket handshake failed: {error}"))?;

    if !authenticate(&mut socket, &token).await? {
        let _ = socket
            .send(Message::Close(Some(
                tokio_tungstenite::tungstenite::protocol::CloseFrame {
                    code:
                        tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Policy,
                    reason: "invalid capture token".into(),
                },
            )))
            .await;
        stop.store(true, Ordering::SeqCst);
        return Ok(());
    }

    let meta = wait_for_meta(&mut meta_rx).await?;
    let text = serde_json::to_string(&meta).map_err(|error| error.to_string())?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|error| format!("failed to send capture metadata: {error}"))?;
    connected.store(true, Ordering::SeqCst);

    loop {
        match packets.recv().await {
            Ok(packet) => {
                let result = match &*packet {
                    CapturePacket::Video(bytes) => {
                        socket.send(Message::Binary(bytes.clone().into())).await
                    }
                    CapturePacket::Audio(bytes) => {
                        socket.send(Message::Binary(bytes.clone().into())).await
                    }
                    CapturePacket::End => {
                        socket.send(Message::Close(None)).await.ok();
                        break;
                    }
                };
                if result.is_err() {
                    stop.store(true, Ordering::SeqCst);
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }

    Ok(())
}

async fn authenticate(
    socket: &mut WebSocketStream<tokio::net::TcpStream>,
    token: &str,
) -> Result<bool, String> {
    let first = socket
        .next()
        .await
        .ok_or_else(|| "capture client closed before authentication".to_string())?
        .map_err(|error| format!("capture handshake failed: {error}"))?;
    let Message::Text(text) = first else {
        return Ok(false);
    };
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "invalid capture handshake".to_string())?;
    Ok(parsed.get("token").and_then(|value| value.as_str()) == Some(token))
}

async fn wait_for_meta(
    meta_rx: &mut watch::Receiver<Option<CaptureMeta>>,
) -> Result<CaptureMeta, String> {
    loop {
        if let Some(meta) = meta_rx.borrow().clone() {
            return Ok(meta);
        }
        meta_rx
            .changed()
            .await
            .map_err(|_| "capture session was cancelled".to_string())?;
    }
}
