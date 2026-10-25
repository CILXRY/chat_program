from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Channel, User
from app.realtime.hub import hub
from app.schemas import ChannelCreate, ChannelOut, ChannelUpdate
from app.security import get_current_user

router = APIRouter(prefix="/api/channels", tags=["channels"])


def _can_manage(channel: Channel, user: User) -> bool:
    return user.role == "admin" or channel.created_by == user.id


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
    user: User = Depends(get_current_user),
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
        created_by=user.id,
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


@router.patch("/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: int,
    body: ChannelUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Channel:
    channel = await db.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    if not _can_manage(channel, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot modify this channel",
        )

    fields = body.model_fields_set
    if "name" in fields:
        if body.name is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Channel name cannot be empty",
            )
        duplicate = await db.scalar(
            select(Channel.id).where(Channel.name == body.name, Channel.id != channel.id)
        )
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A channel with this name already exists",
            )
        channel.name = body.name
    if "topic" in fields:
        channel.topic = body.topic

    await db.commit()
    await db.refresh(channel)

    payload = ChannelOut.model_validate(channel).model_dump(mode="json")
    await hub.broadcast_all({"type": "channel.updated", "channel": payload})
    return channel


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    channel_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    channel = await db.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    if not _can_manage(channel, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot delete this channel",
        )

    channel_count = await db.scalar(select(func.count()).select_from(Channel))
    if (channel_count or 0) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one channel must remain",
        )

    await db.delete(channel)
    await db.commit()

    await hub.broadcast_all({"type": "channel.deleted", "channel_id": channel_id})
    await hub.close_voice_room(channel_id)
