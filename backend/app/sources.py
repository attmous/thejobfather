"""Bounded imports from public GitHub and recruiting APIs."""
import json
import socket
import ssl
from http.client import HTTPConnection, HTTPSConnection, HTTPException as HTTPClientError
from ipaddress import ip_address
from time import monotonic
import re
from base64 import b64decode
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException


def public_json(url: str):
    try:
        data = bytearray()
        with httpx.stream("GET", url, headers={"Accept": "application/json"},
                          timeout=8, follow_redirects=False) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(32 * 1024):
                if len(data) + len(chunk) > 2 * 1024 * 1024:
                    return None
                data.extend(chunk)
        return json.loads(data)
    except (httpx.HTTPError, ValueError):
        return None


def github_repository_url(value: str):
    value = value.strip()
    try:
        url = urlsplit(value if "://" in value else "https://" + value)
        match = re.fullmatch(r"/([\w-]{1,39})/([\w.-]{1,100})/?", url.path, re.ASCII)
        if url.netloc.lower() in ("github.com", "www.github.com") and url.scheme == "https" and match:
            owner, repo = match.groups()
            if repo not in (".", ".."):
                return f"https://github.com/{owner}/{repo}", f"{owner}/{repo}"
    except ValueError:
        pass
    raise HTTPException(422, "Enter the URL of a public GitHub repository.")


def github_preview(value: str):
    url, path = github_repository_url(value)
    api = f"https://api.github.com/repos/{path}"
    repo = public_json(api)
    if not isinstance(repo, dict) or repo.get("private") is not False:
        raise HTTPException(422, "Couldn’t read that public repository. Check the link and try again.")
    readme = public_json(api + "/readme")
    excerpt = ""
    if isinstance(readme, dict) and readme.get("encoding") == "base64":
        try:
            excerpt = b64decode(readme.get("content", "")).decode("utf-8", errors="replace")[:2000]
        except (TypeError, ValueError):
            pass
    languages = public_json(api + "/languages")
    return {"url": url, "label": path, "description": str(repo.get("description") or "")[:600],
            "languages": list(languages)[:12] if isinstance(languages, dict) else [],
            "readme": excerpt}


class PostingHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = False

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden = True
        if tag in {"p", "br", "div", "h2", "h3", "h4", "li"}:
            self.parts.append("\n- " if tag == "li" else "\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = False
        if tag in {"p", "div", "li"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def posting_text(value):
    parser = PostingHTML()
    parser.feed(unescape(str(value or "")))
    return "\n".join(line.strip() for line in "".join(parser.parts).splitlines() if line.strip())


def board_posting(url, *, max_length: int):
    host = url.host
    path = url.path or ""
    greenhouse = re.fullmatch(r"/([A-Za-z0-9_-]{1,100})/jobs/(\d{1,24})/?", path)
    lever = re.fullmatch(r"/([A-Za-z0-9_-]{1,100})/([a-fA-F0-9-]{36})(?:/apply)?/?", path)
    if greenhouse and host in {"boards.greenhouse.io", "job-boards.greenhouse.io"}:
        board, job = greenhouse.groups()
        result = public_json(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job}")
        if isinstance(result, dict) and result.get("title") and result.get("content"):
            return f"Role: {result['title']}\nCompany: {result.get('company_name') or board}\n\n{posting_text(result['content'])}"[:max_length]
    if lever and host in {"jobs.lever.co", "jobs.eu.lever.co"}:
        board, job = lever.groups()
        api = "api.eu.lever.co" if host == "jobs.eu.lever.co" else "api.lever.co"
        result = public_json(f"https://{api}/v0/postings/{board}/{job}?mode=json")
        if isinstance(result, dict) and result.get("text"):
            sections = [result.get("descriptionPlain") or posting_text(result.get("description"))]
            for entry in result.get("lists") or []:
                if isinstance(entry, dict):
                    sections.extend((str(entry.get("text") or ""), posting_text(entry.get("content"))))
            sections.append(result.get("additionalPlain") or posting_text(result.get("additional")))
            text = "\n".join(str(item) for item in sections if item)
            if text.strip():
                return f"Role: {result['text']}\nCompany: {board}\n\n{text}"[:max_length]
    return None


class JobPostingMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag == "script" and (dict(attrs).get("type") or "").lower() == "application/ld+json":
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            self.blocks.append("".join(self.current))
            self.current = None


def job_posting_nodes(value):
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            types = item.get("@type", [])
            if "JobPosting" in ([types] if isinstance(types, str) else types or []):
                yield item
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)


def read_public_html(url):
    """Use only a validated, pinned IP. Let URL Context handle redirects and gated pages."""
    host = url.host.strip("[]")
    secure = url.scheme == "https"
    port = 443 if secure else 80
    connection = None
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        for *_, address in addresses:
            ip = ip_address(address[0])
            if ip.version == 6 and ip.ipv4_mapped:
                ip = ip.ipv4_mapped
            if not ip.is_global or ip.is_multicast or ip.is_reserved:
                return ""
        if not addresses:
            return ""
        def connect_pinned():
            for family, protocol_type, protocol, _, address in addresses[:4]:
                sock = socket.socket(family, protocol_type, protocol)
                sock.settimeout(3)
                try:
                    sock.connect(address)
                    return sock
                except OSError:
                    sock.close()
            raise OSError("No public address responded")

        # The connection object's host stays intact for HTTP Host and TLS SNI.
        connection = HTTPSConnection(host, port, timeout=3, context=ssl.create_default_context()) if secure else HTTPConnection(host, port, timeout=3)
        connection._create_connection = lambda *_args, **_kwargs: connect_pinned()
        target = (url.path or "/") + ("?" + url.query if url.query else "")
        connection.request("GET", target, headers={"Accept": "text/html", "User-Agent": "TheJobFather/1.0"})
        response = connection.getresponse()
        if response.status != 200 or "text/html" not in (response.getheader("Content-Type") or ""):
            return ""
        # Read bounded data incrementally and stop slow responses.
        deadline = monotonic() + 5
        content = bytearray()
        while len(content) <= 1024 * 1024 and monotonic() < deadline:
            chunk = response.read1(32768)
            if not chunk:
                return content.decode("utf-8", errors="replace")
            content.extend(chunk)
    except (OSError, ValueError, HTTPClientError):
        return ""
    finally:
        if connection:
            connection.close()
    return ""


def structured_posting(url, *, max_length):
    parser = JobPostingMetadata()
    parser.feed(read_public_html(url))
    jobs = []
    for block in parser.blocks:
        try:
            jobs.extend(job_posting_nodes(json.loads(block)))
        except (ValueError, TypeError, RecursionError):
            continue
    if len(jobs) != 1:
        return None
    job = jobs[0]
    organization = job.get("hiringOrganization")
    company = organization.get("name", "") if isinstance(organization, dict) else ""
    description = posting_text(job.get("description"))
    if not description:
        return None
    sections = [f"Role: {job.get('title') or ''}", f"Company: {company}", description]
    for field in ("responsibilities", "qualifications", "skills"):
        if job.get(field):
            sections.append(f"{field.title()}: {posting_text(job[field])}")
    return "\n\n".join(sections)[:max_length]
