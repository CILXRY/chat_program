use super::CapturePacket;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

const SAMPLE_RATE: usize = 48_000;
const CHANNELS: usize = 2;
const FRAME_BYTES: usize = 4; // f32, converted to i16 on the wire
const CHUNK_FRAMES: usize = 480; // 10 ms
const CHUNK_SAMPLES: usize = CHUNK_FRAMES * CHANNELS;
const CHUNK_BYTES: usize = CHUNK_FRAMES * CHANNELS * FRAME_BYTES;

pub fn run(packets: broadcast::Sender<Arc<CapturePacket>>, stop: Arc<AtomicBool>) {
    let _ = initialize_mta();
    if let Err(error) = loopback_loop(packets.clone(), stop.clone()) {
        eprintln!("[capture] system audio failed: {error}");
    }

    // If event-driven loopback is unavailable, retry with polling before
    // giving up. Some virtual audio drivers reject the event handle.
    if !stop.load(Ordering::SeqCst) {
        if let Err(error) = polled_loopback_loop(packets, stop) {
            eprintln!("[capture] polling system audio failed: {error}");
        }
    }
}

fn loopback_loop(
    packets: broadcast::Sender<Arc<CapturePacket>>,
    stop: Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = open_client(StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: 200_000,
    })?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    client.start_stream()?;

    let mut pending: VecDeque<u8> = VecDeque::with_capacity(CHUNK_BYTES * 4);
    while !stop.load(Ordering::SeqCst) {
        if event.wait_for_event(250).is_ok() {
            capture.read_from_device_to_deque(&mut pending)?;
            drain_chunks(&mut pending, &packets);
        }
    }
    client.stop_stream().ok();
    Ok(())
}

fn polled_loopback_loop(
    packets: broadcast::Sender<Arc<CapturePacket>>,
    stop: Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = open_client(StreamMode::PollingShared {
        autoconvert: true,
        buffer_duration_hns: 200_000,
    })?;
    let capture = client.get_audiocaptureclient()?;
    client.start_stream()?;

    let mut pending: VecDeque<u8> = VecDeque::with_capacity(CHUNK_BYTES * 4);
    while !stop.load(Ordering::SeqCst) {
        capture.read_from_device_to_deque(&mut pending)?;
        drain_chunks(&mut pending, &packets);
        std::thread::sleep(Duration::from_millis(10));
    }
    client.stop_stream().ok();
    Ok(())
}

fn open_client(mode: StreamMode) -> Result<wasapi::AudioClient, Box<dyn std::error::Error>> {
    let enumerator = DeviceEnumerator::new()?;
    let device = enumerator.get_default_device(&Direction::Render)?;
    let mut client = device.get_iaudioclient()?;
    let format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        SAMPLE_RATE as usize,
        CHANNELS,
        None,
    );
    client.initialize_client(&format, &Direction::Capture, &mode)?;
    Ok(client)
}

fn drain_chunks(pending: &mut VecDeque<u8>, packets: &broadcast::Sender<Arc<CapturePacket>>) {
    while pending.len() >= CHUNK_BYTES {
        let mut pcm = Vec::with_capacity(CHUNK_SAMPLES * 2);
        for _ in 0..CHUNK_SAMPLES {
            let bytes = [
                pending.pop_front().unwrap_or(0),
                pending.pop_front().unwrap_or(0),
                pending.pop_front().unwrap_or(0),
                pending.pop_front().unwrap_or(0),
            ];
            let sample = f32::from_le_bytes(bytes).clamp(-1.0, 1.0);
            let value = (sample * 32767.0) as i16;
            pcm.extend_from_slice(&value.to_le_bytes());
        }
        let mut packet = Vec::with_capacity(pcm.len() + 1);
        packet.push(2);
        packet.extend_from_slice(&pcm);
        let _ = packets.send(Arc::new(CapturePacket::Audio(packet)));
    }
}
