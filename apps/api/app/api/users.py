from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.schemas import UserPublic
from app.security import get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[User]:
    users = await db.scalars(select(User).order_by(User.display_name, User.id))
    return list(users)
