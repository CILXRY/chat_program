import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.db import SessionLocal
from app.models import Channel, User
from app.realtime.hub import hub
from app.schemas import UserPublic
from app.security import decode_access_token

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_FRAME_BYTES = 64 * 1024


async def _authenticate(token: str | None) -> dict | None:
    if not token:
        return None
    user_id = decode_access_token(token)
    if user_id is None:
        return None
    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None:
            return None
        return UserPublic.model_validate(user).model_dump(mode="json")


async def _get_channel(channel_id: int) -> Channel | None:
    async with SessionLocal() as db:
        return await db.get(Channel, channel_id)


async def _error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "message": message})


def _int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


async def _handle_event(uid: int, websocket: WebSocket, event: dict) -> None:
    event_type = event.get("type")

    if event_type == "ping":
        await websocket.send_json({"type": "pong"})
        return

    if event_type == "subscribe":
        channel_id = _int(event.get("channel_id"))
        if channel_id is None or await _get_channel(channel_id) is None:
            await _error(websocket, "Channel not found")
            return
        hub.subscribe(uid, channel_id)
        await websocket.send_json({"type": "subscribed", "channel_id": channel_id})
        return

    if event_type == "unsubscribe":
        channel_id = _int(event.get("channel_id"))
        if channel_id is not None:
            hub.unsubscribe(uid, channel_id)
        return

    if event_type == "typing":
        channel_id = _int(event.get("channel_id"))
        if channel_id is None or await _get_channel(channel_id) is None:
            return
        await hub.typing(uid, channel_id)
        return

    if event_type == "voice.join":
        channel_id = _int(event.get("channel_id"))
        channel = await _get_channel(channel_id) if channel_id is not None else None
        if channel is None:
            await _error(websocket, "Channel not found")
            return
        if channel.type != "voice":
            await _error(websocket, "This channel is not a voice channel")
            return
        await hub.voice_join(uid, channel.id)
        return

    if event_type == "voice.leave":
        await hub.voice_leave(uid)
        return

    if event_type == "voice.media":
        channel_id = _int(event.get("channel_id")) or hub.voice_channel_of(uid)
        if channel_id is None:
            return
        muted = event.get("muted")
        sharing = event.get("sharing")
        await hub.voice_update(
            uid,
            channel_id,
            muted=muted if isinstance(muted, bool) else None,
            sharing=sharing if isinstance(sharing, bool) else None,
        )
        return

    if event_type in {"rtc.offer", "rtc.answer"}:
        target_uid = _int(event.get("target_user_id"))
        sdp = event.get("sdp")
        if target_uid is None or not isinstance(sdp, dict):
            return
        await hub.relay_signal(uid, target_uid, {"type": event_type, "sdp": sdp})
        return

    if event_type == "rtc.ice":
        target_uid = _int(event.get("target_user_id"))
        candidate = event.get("candidate")
        if target_uid is None:
            return
        await hub.relay_signal(uid, target_uid, {"type": "rtc.ice", "candidate": candidate})
        return

    await _error(websocket, f"Unknown event type: {event_type!r}")


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    token = websocket.cookies.get(settings.cookie_name) or websocket.query_params.get("token")
    user = await _authenticate(token)
    if user is None:
        await websocket.close(code=4401)
        return

    uid = user["id"]
    await hub.connect(websocket, user)

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode("utf-8")) > MAX_FRAME_BYTES:
                await websocket.close(code=1009)
                break
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                await _error(websocket, "Invalid JSON")
                continue
            if not isinstance(event, dict):
                await _error(websocket, "Event must be an object")
                continue
            try:
                await _handle_event(uid, websocket, event)
            except Exception:
                logger.exception("error handling websocket event %s", event.get("type"))
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("websocket connection failed for user %s", uid)
    finally:
        await hub.disconnect(websocket, uid)
