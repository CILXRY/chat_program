from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health", include_in_schema=False)
@router.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "db": "ok",
        "app": settings.app_name,
        "environment": settings.environment,
    }
