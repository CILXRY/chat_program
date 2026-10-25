import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, channels, health, messages, users, ws
from app.config import settings
from app.db import SessionLocal, engine
from app.seed import ensure_defaults, seed_demo

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("nebula")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.seed_defaults or settings.seed_demo:
        async with SessionLocal() as db:
            if settings.seed_defaults:
                await ensure_defaults(db)
            if settings.seed_demo:
                await seed_demo(db)
    logger.info("Nebula API ready")
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    health.router,
    auth.router,
    users.router,
    channels.router,
    messages.router,
    ws.router,
):
    app.include_router(router)
