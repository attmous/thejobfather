"""Build and test an isolated Docker workspace; never touches the user's volume.

Run with Python 3.9+: python3 scripts/smoke-docker.py
No Gemini requests are made. The disposable test volume is deleted on exit.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    PORT = sock.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"
ENV = {**os.environ, "JOBFATHER_PORT": str(PORT), "GEMINI_API_KEY": ""}
COMPOSE = ["docker", "compose", "-p", f"jobfather-smoke-{os.getpid()}"]


def compose(*args):
    return subprocess.run(COMPOSE + list(args), cwd=ROOT, env=ENV, check=True)


def request(path, body=None, *, origin=BASE):
    headers = {"Origin": origin}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers,
                                 method="PUT" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=20) as response:
        content = response.read()
        return json.loads(content) if "application/json" in response.headers.get("Content-Type", "") else content


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print("PASS:", message, flush=True)


try:
    compose("config", "--quiet")
    compose("up", "--build", "-d", "--wait", "--wait-timeout", "180")
    check(request("/api/health") == {"status": "ok"}, "frontend proxies to healthy backend")
    check(b"Profile" in request("/"), "application opens at the root URL")
    check(b"Profile" in request("/app"), "existing /app links still open the application")
    check(request("/api/profile")["version"] == 0, "test starts with an empty isolated profile")
    saved = request("/api/profile", {"version": 0, "details": {
        "name": "Docker Smoke Test", "role": "Engineer", "skills": "Python"}})
    check(saved["version"] == 1, "profile can be written through the proxy")
    check(request("/api/settings/gemini", {"api_key": "AQ.test-key-for-storage-only"}) == {"source": "app"},
          "authorization-format key saves through the frontend proxy")
    try:
        request("/api/settings/gemini", {"api_key": "test-key-for-storage-only"}, origin="https://untrusted.example")
        raise AssertionError("cross-origin key changes were accepted")
    except urllib.error.HTTPError as error:
        check(error.code == 403, "cross-origin key changes are rejected")
    compose("exec", "-T", "backend", "python", "-c",
            "import os, pathlib; assert os.getuid() != 0; "
            "assert pathlib.Path('/data/gemini.key').stat().st_mode & 0o777 == 0o600; "
            "assert pathlib.Path('/app/backend/fonts/DejaVuSans.ttf').is_file()")
    compose("exec", "-T", "frontend", "node", "-e", "if(process.getuid()===0) process.exit(1)")
    compose("down")
    compose("up", "-d", "--wait", "--wait-timeout", "180")
    check(request("/api/profile")["details"]["name"] == "Docker Smoke Test", "profile survives container recreation")
    check(request("/api/settings/gemini") == {"source": "app"}, "saved key survives without exposing its value")
    print("Docker smoke checks passed. No Gemini calls were made.", flush=True)
except Exception:
    subprocess.run(COMPOSE + ["logs", "--tail", "60"], cwd=ROOT, env=ENV)
    raise
finally:
    compose("down", "--volumes", "--remove-orphans")
