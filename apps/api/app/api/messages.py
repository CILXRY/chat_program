from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Channel, Message, User
from app.realtime.hub import hub
from app.schemas import MessageCreate, MessageOut, MessagePage
from app.security import get_current_user

router = APIRouter(tags=["messages"])


@router.get("/api/channels/{channel_id}/messages", response_model=MessagePage)
async def list_messages(
    channel_id: int,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> MessagePage:
    channel = await db.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Channel not found")

    statement = (
        select(Message)
        .where(Message.channel_id == channel_id)
        .order_by(Message.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        statement = statement.where(Message.id < before)

    rows = list(await db.scalars(statement))
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [MessageOut.model_validate(message) for message in reversed(rows)]
    return MessagePage(items=items, has_more=has_more)


@router.post(
    "/api/channels/{channel_id}/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_message(
    channel_id: int,
    body: MessageCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Message:
    channel = await db.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    if channel.type != "text":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Messages can only be sent to text channels",
        )

    message = Message(channel_id=channel_id, author_id=user.id, content=body.content)
    db.add(message)
    await db.commit()
    await db.refresh(message)
    message.author = user

    payload = MessageOut.model_validate(message).model_dump(mode="json")
    await hub.broadcast_channel(
        channel_id,
        {
            "type": "message.created",
            "message": payload,
            "nonce": body.nonce,
        },
    )
    return message


@router.delete("/api/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.author_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own messages",
        )

    channel_id = message.channel_id
    await db.delete(message)
    await db.commit()
    await hub.broadcast_channel(
        channel_id,
        {
            "type": "message.deleted",
            "channel_id": channel_id,
            "message_id": message_id,
        },
    )
