import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, Message, User
from app.security import hash_password, pick_avatar_color

logger = logging.getLogger(__name__)

DEFAULT_CHANNELS = [
    {
        "name": "general",
        "type": "text",
        "topic": "从这里开始，和大家打个招呼吧",
    },
    {
        "name": "random",
        "type": "text",
        "topic": "摸鱼、分享、随便聊聊",
    },
    {
        "name": "voice-lounge",
        "type": "voice",
        "topic": "语音聊天 + 屏幕共享",
    },
]

DEMO_USERS = [
    {"username": "alice", "display_name": "Alice", "password": "nebula123"},
    {"username": "bob", "display_name": "Bob", "password": "nebula123"},
]


async def ensure_defaults(db: AsyncSession) -> None:
    count = await db.scalar(select(func.count()).select_from(Channel))
    if count:
        return
    for position, data in enumerate(DEFAULT_CHANNELS):
        db.add(Channel(**data, position=position))
    await db.commit()
    logger.info("created default channels")


async def seed_demo(db: AsyncSession) -> None:
    created = []
    for data in DEMO_USERS:
        existing = await db.scalar(select(User).where(User.username == data["username"]))
        if existing:
            continue
        user = User(
            username=data["username"],
            display_name=data["display_name"],
            password_hash=hash_password(data["password"]),
            avatar_color=pick_avatar_color(data["username"]),
        )
        db.add(user)
        created.append(data["username"])
    if not created:
        return

    await db.commit()
    logger.info("seeded demo users: %s", ", ".join(created))

    existing_message = await db.scalar(select(Message.id).limit(1))
    if existing_message is not None:
        return

    alice = await db.scalar(select(User).where(User.username == "alice"))
    general = await db.scalar(select(Channel).where(Channel.name == "general"))
    if alice is not None and general is not None:
        db.add(
            Message(
                channel_id=general.id,
                author_id=alice.id,
                content=(
                    "欢迎来到 Nebula 👋\n\n"
                    "从左侧选择一个频道开始聊天；想开麦或共享屏幕，"
                    "就进入 voice-lounge。"
                ),
            )
        )
        await db.commit()
