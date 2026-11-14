import json
import re
from typing import Optional
from urllib.parse import urlsplit

import httpx
from pydantic import HttpUrl

HOST = "jobs.ashbyhq.com"
BOARD_API = "https://api.ashbyhq.com/posting-api/job-board/"
MAX_BOARD_BYTES = 12 * 1024 * 1024
POSTING_PATH = re.compile(
    r"/([A-Za-z0-9_-]{1,100})/"
    r"([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})"
    r"(?:/application)?/?"
)


def ashby_posting_text(url: HttpUrl, *, max_length: int) -> Optional[str]:
    if url.host != HOST:
        return None
    match = POSTING_PATH.fullmatch(url.path or "")
    if not match:
        return None
    board, posting_id = match.groups()

    try:
        content = bytearray()
        with httpx.stream(
            "GET", BOARD_API + board, headers={"Accept": "application/json"},
            timeout=8.0, follow_redirects=False,
        ) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(chunk_size=64 * 1024):
                if len(content) + len(chunk) > MAX_BOARD_BYTES:
                    return None
                content.extend(chunk)
        payload = json.loads(content)
    except (httpx.HTTPError, ValueError):
        return None

    jobs = payload.get("jobs") if isinstance(payload, dict) else None
    if not isinstance(jobs, list):
        return None
    for job in jobs:
        if not isinstance(job, dict) or not isinstance(job.get("jobUrl"), str):
            continue
        try:
            address = urlsplit(job["jobUrl"])
        except ValueError:
            continue
        if address.hostname != HOST or address.path.rstrip("/").lower() != f"/{board}/{posting_id}".lower():
            continue
        title, description = job.get("title"), job.get("descriptionPlain")
        if isinstance(title, str) and isinstance(description, str) and title.strip() and description.strip():
            return f"Role: {title.strip()}\n\n{description.strip()}"[:max_length]
    return None
