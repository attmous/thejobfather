"""Routes structured text tasks to the selected model provider."""
import json

import httpx

from .gemini import GeminiError, generate_json as generate_gemini
from .settings import text_credentials


def generate_json(instructions, parts, schema, *, url_context=False):
    if url_context or any("text" not in part for part in parts):
        return generate_gemini(instructions, parts, schema, url_context=url_context)
    try:
        provider, model, key = text_credentials()
    except (OSError, ValueError, KeyError):
        raise GeminiError(503, "Couldn’t read text model settings.") from None
    if provider == "gemini":
        return generate_gemini(instructions, parts, schema)
    label = "OpenAI" if provider == "openai" else "Anthropic"
    if not key:
        raise GeminiError(503, f"Add an API key for {label} in Settings.")
    prompt = "\n\n".join(part["text"] for part in parts)
    system = instructions + "\nReturn only a JSON object matching this schema:\n" + json.dumps(schema)
    if provider == "openai":
        url = "https://api.openai.com/v1/responses"
        headers = {"Authorization": f"Bearer {key}"}
        payload = {"model": model, "instructions": system, "input": prompt, "store": False,
                   "max_output_tokens": 8192, "text": {"format": {"type": "json_object"}}}
    else:
        url = "https://api.anthropic.com/v1/messages"
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        payload = {"model": model, "system": system, "max_tokens": 8192,
                   "messages": [{"role": "user", "content": prompt}]}
    try:
        response = httpx.post(url, headers=headers, json=payload, timeout=60)
    except httpx.TimeoutException:
        raise GeminiError(504, f"{label} took too long. Try again.") from None
    except httpx.RequestError:
        raise GeminiError(503, f"Couldn’t reach {label}. Try again.") from None
    if response.status_code == 429:
        raise GeminiError(429, f"{label}’s request limit was reached. Try again later.")
    if response.status_code in (401, 403, 404):
        raise GeminiError(503, f"Check the {label} key and model ID in Settings.")
    if not response.is_success:
        raise GeminiError(502, f"{label} couldn’t complete the request. Check the selected model.")
    try:
        result = response.json()
        if provider == "openai" and result["status"] == "completed":
            content = [part for output in result["output"] if output["type"] == "message"
                       for part in output["content"] if part["type"] == "output_text"]
        elif provider == "anthropic" and result["stop_reason"] == "end_turn":
            content = [part for part in result["content"] if part["type"] == "text"]
        else:
            raise ValueError("Incomplete response")
        output = json.loads("".join(part["text"] for part in content))
        if isinstance(output, dict):
            return output
    except (ValueError, KeyError, TypeError, AttributeError):
        pass
    raise GeminiError(502, f"{label} returned an incomplete response. Try again.")
