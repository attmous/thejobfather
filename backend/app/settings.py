import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, SecretStr, field_validator

from . import profile

router = APIRouter(prefix="/api/settings")


def key_file() -> Path:
    return profile.DB_PATH.with_name("gemini.key")


def saved_key() -> Optional[str]:
    try:
        return key_file().read_text(encoding="ascii").strip() or None
    except FileNotFoundError:
        return None


def gemini_api_key() -> Optional[str]:
    return saved_key() or os.environ.get("GEMINI_API_KEY", "").strip() or None


class GeminiSettings(BaseModel):
    source: Literal["app", "environment", "none"]


class SaveGeminiKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: SecretStr

    @field_validator("api_key")
    @classmethod
    def check_key(cls, secret: SecretStr) -> SecretStr:
        key = secret.get_secret_value().strip()
        if not 16 <= len(key) <= 256 or not all(
            char.isascii() and (char.isalnum() or char in "-_") for char in key
        ):
            raise ValueError("Enter a Gemini API key.")
        return SecretStr(key)


@router.get("/gemini", response_model=GeminiSettings)
def get_gemini_settings():
    try:
        if saved_key():
            return GeminiSettings(source="app")
    except (OSError, UnicodeError):
        raise HTTPException(500, "Couldn’t read the saved key.") from None
    return GeminiSettings(source="environment" if os.environ.get("GEMINI_API_KEY", "").strip() else "none")


@router.put("/gemini", response_model=GeminiSettings)
def save_gemini_key(body: SaveGeminiKey):
    target = key_file()
    temporary = None
    try:
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with NamedTemporaryFile(mode="w", encoding="ascii", dir=target.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(body.api_key.get_secret_value())
            file.flush()
            os.fsync(file.fileno())
        temporary.replace(target)
    except OSError:
        raise HTTPException(500, "Couldn’t save the key. Try again.") from None
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return GeminiSettings(source="app")


@router.delete("/gemini", response_model=GeminiSettings)
def remove_gemini_key():
    try:
        key_file().unlink(missing_ok=True)
    except OSError:
        raise HTTPException(500, "Couldn’t remove the key. Try again.") from None
    return get_gemini_settings()
