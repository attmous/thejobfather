import json
import os
import re
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
        # Gemini authorization keys use an AQ. prefix; preserve the dot.
        if not 16 <= len(key) <= 256 or not all(
            char.isascii() and (char.isalnum() or char in "-_.") for char in key
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


TextProvider = Literal["gemini", "openai", "anthropic"]
PROVIDER_ENV = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


class TextSettings(BaseModel):
    provider: TextProvider
    model: str
    configured: bool


class SaveTextSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    provider: TextProvider
    model: str = ""
    api_key: Optional[SecretStr] = None


def text_settings_file() -> Path:
    return profile.DB_PATH.with_name("text-provider.json")


def text_credentials():
    try:
        stored = json.loads(text_settings_file().read_text(encoding="utf-8"))
    except FileNotFoundError:
        stored = {}
    provider = stored.get("provider", "gemini")
    if provider == "gemini":
        return provider, os.environ.get("GEMINI_TEXT_MODEL", "gemini-3.5-flash-lite"), gemini_api_key()
    return provider, stored["model"], stored.get("api_key") or os.environ.get(PROVIDER_ENV[provider], "").strip()


@router.get("/text", response_model=TextSettings)
def get_text_settings():
    try:
        provider, model, key = text_credentials()
    except (OSError, ValueError, KeyError):
        raise HTTPException(500, "Couldn’t read text model settings.") from None
    return TextSettings(provider=provider, model=model, configured=bool(key))


@router.put("/text", response_model=TextSettings)
def save_text_settings(body: SaveTextSettings):
    target = text_settings_file()
    key = body.api_key.get_secret_value().strip() if body.api_key else ""
    if key and not re.fullmatch(r"[!-~]{16,512}", key):
        raise HTTPException(422, "Enter a valid API key.")
    payload = {"provider": body.provider}
    temporary = None
    try:
        if body.provider != "gemini":
            if not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,128}", body.model):
                raise HTTPException(422, "Enter the provider’s model ID.")
            try:
                previous = json.loads(target.read_text(encoding="utf-8"))
            except FileNotFoundError:
                previous = {}
            if not key and previous.get("provider") == body.provider:
                key = previous.get("api_key", "")
            if not key and not os.environ.get(PROVIDER_ENV[body.provider], "").strip():
                raise HTTPException(422, "Add an API key for this provider.")
            payload.update(model=body.model, api_key=key)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as file:
            temporary = Path(file.name)
            json.dump(payload, file)
            file.flush()
            os.fsync(file.fileno())
        temporary.replace(target)
    except (OSError, ValueError):
        raise HTTPException(500, "Couldn’t save text model settings.") from None
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return get_text_settings()
