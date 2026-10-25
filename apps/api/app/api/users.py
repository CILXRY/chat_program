from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.realtime.hub import hub
from app.schemas import ProfileUpdate, RoleUpdate, UserPublic
from app.security import get_current_user, require_admin

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
async def list_users(
    removed: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[User]:
    if removed and user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required",
        )

    statement = (
        select(User).where(User.is_active.is_(not removed)).order_by(User.display_name, User.id)
    )
    users = await db.scalars(statement)
    return list(users)


@router.patch("/me", response_model=UserPublic)
async def update_profile(
    body: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> User:
    fields = body.model_fields_set
    if "display_name" in fields:
        if body.display_name is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Display name cannot be empty",
            )
        user.display_name = body.display_name
    if "avatar_color" in fields:
        if body.avatar_color is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Avatar color is required",
            )
        user.avatar_color = body.avatar_color

    await db.commit()
    await db.refresh(user)

    payload = UserPublic.model_validate(user).model_dump(mode="json")
    await hub.broadcast_all({"type": "user.updated", "user": payload})
    return user


@router.post("/{user_id}/role", response_model=UserPublic)
async def update_role(
    user_id: int,
    body: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )
    target = await db.get(User, user_id)
    if target is None or not target.is_active:
        raise HTTPException(status_code=404, detail="Member not found")

    if target.role == "admin" and body.role == "member":
        admin_count = await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == "admin", User.is_active.is_(True))
        )
        if (admin_count or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one administrator must remain",
            )

    target.role = body.role
    await db.commit()
    await db.refresh(target)

    payload = UserPublic.model_validate(target).model_dump(mode="json")
    await hub.broadcast_all({"type": "user.updated", "user": payload})
    return target


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove yourself",
        )
    target = await db.get(User, user_id)
    if target is None or not target.is_active:
        raise HTTPException(status_code=404, detail="Member not found")

    if target.role == "admin":
        admin_count = await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == "admin", User.is_active.is_(True))
        )
        if (admin_count or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one administrator must remain",
            )

    target.is_active = False
    target.removed_at = datetime.now(UTC)
    await db.commit()

    await hub.broadcast_all({"type": "member.removed", "user_id": target.id})
    await hub.disconnect_user(target.id)


@router.post("/{user_id}/restore", response_model=UserPublic)
async def restore_member(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> User:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Member is already active",
        )

    target.is_active = True
    target.removed_at = None
    await db.commit()
    await db.refresh(target)

    payload = UserPublic.model_validate(target).model_dump(mode="json")
    await hub.broadcast_all({"type": "member.restored", "user": payload})
    return target
