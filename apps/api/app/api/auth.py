from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.realtime.hub import hub
from app.schemas import LoginIn, RegisterIn, UserPublic
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

    user = User(
        username=body.username,
        display_name=body.display_name or body.username,
        password_hash=hash_password(body.password),
        avatar_color=pick_avatar_color(body.username),
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

    set_auth_cookie(response, create_access_token(user.id))
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

    set_auth_cookie(response, create_access_token(user.id))
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    clear_auth_cookie(response)


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)) -> User:
    return user
