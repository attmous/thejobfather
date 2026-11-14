import json
import os
import re
from pathlib import Path

import httpx
from dotenv import load_dotenv

from .settings import gemini_api_key

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DEFAULT_MODEL = "gemini-3.5-flash-lite"
API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def generate_json(
    instructions: str, parts: list, schema: dict, *, url_context: bool = False,
) -> dict:
    try:
        key = gemini_api_key()
    except (OSError, UnicodeError):
        raise GeminiError(503, "Couldn’t read the saved Gemini key.") from None
    if not key:
        raise GeminiError(503, "Add a Gemini API key in Settings to use Gemini.")
    model = os.environ.get("GEMINI_TEXT_MODEL", DEFAULT_MODEL).strip()
    if not re.fullmatch(r"gemini-[A-Za-z0-9.-]+", model):
        raise GeminiError(503, "Check GEMINI_TEXT_MODEL on the server.")

    payload = {
        "systemInstruction": {"parts": [{"text": instructions}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
            "maxOutputTokens": 8192,
        },
    }
    if url_context:
        payload["tools"] = [{"urlContext": {}}]

    try:
        response = httpx.post(
            f"{API_ROOT}/{model}:generateContent",
            headers={"x-goog-api-key": key},
            json=payload,
            timeout=45.0,
        )
    except httpx.TimeoutException:
        raise GeminiError(504, "Gemini took too long. Try again.") from None
    except httpx.RequestError:
        raise GeminiError(503, "Couldn’t reach Gemini. Try again.") from None

    if response.status_code in (401, 403):
        raise GeminiError(503, "Check the Gemini API key and model access.")
    if response.status_code == 404:
        raise GeminiError(503, "The configured Gemini model is unavailable.")
    if response.status_code == 429:
        raise GeminiError(429, "Gemini’s request limit was reached. Try again later.")
    if response.is_error or response.is_redirect:
        raise GeminiError(502, "Gemini couldn’t complete the request. Try again.")

    try:
        candidate = response.json()["candidates"][0]
        if url_context and not any(
            item.get("urlRetrievalStatus") == "URL_RETRIEVAL_STATUS_SUCCESS"
            for item in candidate.get("urlContextMetadata", {}).get("urlMetadata", [])
        ):
            raise GeminiError(422, "Couldn’t open this job link. Paste the job description instead.")
        if candidate.get("finishReason") != "STOP":
            raise ValueError("Incomplete response")
        text = "".join(
            part.get("text", "") for part in candidate["content"]["parts"]
            if not part.get("thought")
        )
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        pass
    if url_context:
        raise GeminiError(422, "Couldn’t read this job posting. Paste the job description instead.")
    raise GeminiError(502, "Gemini couldn’t read the source. Try again.")
