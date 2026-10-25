from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, Message, User
from app.seed import seed_demo


async def test_seed_demo_is_idempotent_and_adds_welcome_message(
    session: AsyncSession,
) -> None:
    await seed_demo(session)
    assert await session.scalar(select(func.count()).select_from(User)) == 2
    assert await session.scalar(select(func.count()).select_from(Message)) == 1

    message = await session.scalar(select(Message))
    assert message is not None
    assert "欢迎来到 Nebula" in message.content

    channel = await session.scalar(select(Channel).where(Channel.name == "general"))
    assert channel is not None
    assert message.channel_id == channel.id

    await seed_demo(session)
    assert await session.scalar(select(func.count()).select_from(User)) == 2
    assert await session.scalar(select(func.count()).select_from(Message)) == 1
