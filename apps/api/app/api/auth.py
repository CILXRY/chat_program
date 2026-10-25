from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import User
from app.realtime.hub import hub
from app.schemas import LoginIn, PasswordChange, RegisterIn, UserPublic
from app.security import (
    clear_auth_cookie,
    create_access_token,
    get_current_user,
    hash_password,
    pick_avatar_color,
    set_auth_cookie,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue_session(response: Response, user_id: int, remember: bool) -> None:
    days = settings.jwt_remember_days if remember else settings.jwt_session_days
    set_auth_cookie(response, create_access_token(user_id, days), days * 24 * 60 * 60)


@router.post("/register", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    existing = await db.scalar(select(User.id).where(User.username == body.username))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username is already taken",
        )

    active_admins = await db.scalar(
        select(func.count()).select_from(User).where(User.role == "admin", User.is_active.is_(True))
    )
    user = User(
        username=body.username,
        display_name=body.display_name or body.username,
        password_hash=hash_password(body.password),
        avatar_color=pick_avatar_color(body.username),
        role="admin" if not active_admins else "member",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await hub.broadcast_all(
        {
            "type": "user.created",
            "user": UserPublic.model_validate(user).model_dump(mode="json"),
        }
    )

    _issue_session(response, user.id, remember=True)
    return user


@router.post("/login", response_model=UserPublic)
async def login(
    body: LoginIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been removed from the workspace",
        )

    _issue_session(response, user.id, remember=body.remember)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    clear_auth_cookie(response)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChange,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password",
        )

    user.password_hash = hash_password(body.new_password)
    await db.commit()


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)) -> User:
    return user
