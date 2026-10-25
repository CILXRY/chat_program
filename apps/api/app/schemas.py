import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,24}$")
CHANNEL_RE = re.compile(r"^[\w\u4e00-\u9fff-]{1,24}$")


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    avatar_color: str
    created_at: datetime


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    display_name: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        value = value.strip().lower()
        if not USERNAME_RE.match(value):
            raise ValueError("username may only contain a-z, 0-9 and underscore")
        return value

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("password")
    @classmethod
    def check_password_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("password must be at most 72 bytes")
        return value


class LoginIn(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().lower()


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    type: Literal["text", "voice"] = "text"
    topic: str | None = Field(default=None, max_length=160)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = re.sub(r"\s+", "-", value.strip()).lower()
        if not CHANNEL_RE.match(value):
            raise ValueError("channel name may contain letters, numbers, - and _")
        return value

    @field_validator("topic")
    @classmethod
    def normalize_topic(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: Literal["text", "voice"]
    topic: str | None
    position: int
    created_at: datetime


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    nonce: str | None = Field(default=None, max_length=64)

    @field_validator("content")
    @classmethod
    def strip_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message cannot be empty")
        return value


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    channel_id: int
    content: str
    created_at: datetime
    edited_at: datetime | None
    author: UserPublic


class MessagePage(BaseModel):
    items: list[MessageOut]
    has_more: bool
