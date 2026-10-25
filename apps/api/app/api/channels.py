from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Channel, User
from app.realtime.hub import hub
from app.schemas import ChannelCreate, ChannelOut
from app.security import get_current_user

router = APIRouter(prefix="/api/channels", tags=["channels"])


@router.get("", response_model=list[ChannelOut])
async def list_channels(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Channel]:
    channels = await db.scalars(select(Channel).order_by(Channel.position, Channel.id))
    return list(channels)


@router.post("", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    body: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Channel:
    existing = await db.scalar(select(Channel.id).where(Channel.name == body.name))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A channel with this name already exists",
        )

    max_position = await db.scalar(select(func.max(Channel.position)))
    channel = Channel(
        name=body.name,
        type=body.type,
        topic=body.topic,
        position=(max_position or 0) + 1,
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)

    payload = ChannelOut.model_validate(channel).model_dump(mode="json")
    await hub.broadcast_all({"type": "channel.created", "channel": payload})
    return channel


@router.get("/{channel_id}", response_model=ChannelOut)
async def get_channel(
    channel_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Channel:
    channel = await db.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    return channel
