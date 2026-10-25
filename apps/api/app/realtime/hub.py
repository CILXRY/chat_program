from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class VoiceParticipant:
    user_id: int
    muted: bool = False
    sharing: bool = False

    def as_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "muted": self.muted,
            "sharing": self.sharing,
        }


class Hub:
    """In-memory connection registry.

    One API process owns chat fan-out, presence and voice signaling rooms.
    Horizontal scaling would move this state to Redis pub/sub.
    """

    def __init__(self) -> None:
        self.connections: dict[int, set[WebSocket]] = {}
        self.user_info: dict[int, dict] = {}
        self.channel_subs: dict[int, set[int]] = {}
        self.voice_rooms: dict[int, dict[int, VoiceParticipant]] = {}
        self.voice_of: dict[int, int] = {}
        self.typing_last: dict[tuple[int, int], float] = {}

    async def _send(self, websocket: WebSocket, payload: dict) -> None:
        try:
            await websocket.send_json(payload)
        except Exception:
            logger.debug("failed to send websocket payload", exc_info=True)

    async def connect(self, websocket: WebSocket, user: dict) -> None:
        await websocket.accept()
        uid = user["id"]
        self.connections.setdefault(uid, set()).add(websocket)
        self.user_info[uid] = user
        await websocket.send_json(
            {
                "type": "ready",
                "user": user,
                "online_user_ids": sorted(self.connections.keys()),
            }
        )
        await self.broadcast_all(
            {"type": "presence.update", "user_id": uid, "online": True},
            exclude_ws=websocket,
        )

    async def disconnect(self, websocket: WebSocket, uid: int) -> None:
        connections = self.connections.get(uid)
        if connections is not None:
            connections.discard(websocket)
        if connections:
            return

        await self.voice_leave(uid)
        self.connections.pop(uid, None)
        self.user_info.pop(uid, None)
        for channel_id in list(self.channel_subs):
            subscribers = self.channel_subs[channel_id]
            subscribers.discard(uid)
            if not subscribers:
                self.channel_subs.pop(channel_id, None)
        await self.broadcast_all({"type": "presence.update", "user_id": uid, "online": False})

    async def send_user(self, uid: int, payload: dict) -> None:
        for websocket in list(self.connections.get(uid, ())):
            await self._send(websocket, payload)

    async def broadcast_all(self, payload: dict, exclude_ws: WebSocket | None = None) -> None:
        for connections in list(self.connections.values()):
            for websocket in list(connections):
                if websocket is exclude_ws:
                    continue
                await self._send(websocket, payload)

    async def broadcast_channel(
        self,
        channel_id: int,
        payload: dict,
        *,
        exclude_user: int | None = None,
    ) -> None:
        for uid in list(self.channel_subs.get(channel_id, ())):
            if uid == exclude_user:
                continue
            await self.send_user(uid, payload)

    def subscribe(self, uid: int, channel_id: int) -> None:
        self.channel_subs.setdefault(channel_id, set()).add(uid)

    def unsubscribe(self, uid: int, channel_id: int) -> None:
        subscribers = self.channel_subs.get(channel_id)
        if not subscribers:
            return
        subscribers.discard(uid)
        if not subscribers:
            self.channel_subs.pop(channel_id, None)

    async def typing(self, uid: int, channel_id: int) -> None:
        info = self.user_info.get(uid)
        if info is None:
            return
        now = time.monotonic()
        key = (uid, channel_id)
        if now - self.typing_last.get(key, 0.0) < 1.0:
            return
        self.typing_last[key] = now
        await self.broadcast_channel(
            channel_id,
            {
                "type": "typing.start",
                "channel_id": channel_id,
                "user": {"id": uid, "display_name": info["display_name"]},
            },
            exclude_user=uid,
        )

    def voice_channel_of(self, uid: int) -> int | None:
        return self.voice_of.get(uid)

    async def voice_join(self, uid: int, channel_id: int) -> None:
        current = self.voice_of.get(uid)
        if current == channel_id:
            # Rejoining (for example after a reload) must not inherit stale
            # mute/share flags from the previous session.
            self.voice_rooms.setdefault(channel_id, {})[uid] = VoiceParticipant(uid)
            await self._broadcast_voice(channel_id)
            return
        if current is not None:
            await self.voice_leave(uid)
        self.voice_rooms.setdefault(channel_id, {})[uid] = VoiceParticipant(uid)
        self.voice_of[uid] = channel_id
        await self._broadcast_voice(channel_id)

    async def voice_leave(self, uid: int) -> None:
        channel_id = self.voice_of.pop(uid, None)
        if channel_id is None:
            return
        room = self.voice_rooms.get(channel_id)
        if room is None:
            return
        room.pop(uid, None)
        if room:
            await self._broadcast_voice(channel_id)
        else:
            self.voice_rooms.pop(channel_id, None)

    async def voice_update(
        self,
        uid: int,
        channel_id: int,
        *,
        muted: bool | None = None,
        sharing: bool | None = None,
    ) -> None:
        room = self.voice_rooms.get(channel_id)
        if room is None:
            return
        participant = room.get(uid)
        if participant is None:
            return
        if muted is not None:
            participant.muted = muted
        if sharing is not None:
            participant.sharing = sharing
        await self._broadcast_voice(channel_id)

    async def _broadcast_voice(self, channel_id: int) -> None:
        room = self.voice_rooms.get(channel_id)
        if not room:
            return
        payload = {
            "type": "voice.state",
            "channel_id": channel_id,
            "participants": [
                participant.as_dict()
                for participant in sorted(room.values(), key=lambda item: item.user_id)
            ],
        }
        for uid in list(room.keys()):
            await self.send_user(uid, payload)

    async def relay_signal(self, from_uid: int, target_uid: int, payload: dict) -> None:
        channel_id = self.voice_of.get(from_uid)
        if channel_id is None or self.voice_of.get(target_uid) != channel_id:
            return
        await self.send_user(
            target_uid,
            {**payload, "from_user_id": from_uid, "channel_id": channel_id},
        )


hub = Hub()
