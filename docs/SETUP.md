# Setup and troubleshooting

For the quickest start and a judge walkthrough, see the [repository front page](../README.md).

## Docker prerequisites

Install [Docker Desktop](https://docs.docker.com/compose/install/) on macOS or
Windows, or Docker Engine with Compose v2.20+ on Linux. Open Docker Desktop and
wait for the engine to start. You do not need a local Node.js or Python installation.

On macOS with Homebrew, `brew bundle` installs Docker Desktop from the repository’s
`Brewfile`. System permissions may be requested. If you installed Docker Desktop
directly, you can skip Homebrew.

Check the installation:

```sh
docker --version
docker compose version
docker info
```

On macOS and Linux, `sh scripts/check-setup.sh` runs these checks for you.

## Stop and resume

Run these commands from the repository root:

```sh
docker compose down
# Resume later:
docker compose up -d --wait
```

The `jobfather-data` volume stores the profile, imported resume, application drafts,
and saved Gemini key. It survives container recreation and image rebuilds.
**Adding `--volumes` to `docker compose down` permanently deletes that workspace.**
The Docker workspace is separate from any existing `backend/data/` used by local development.

## Optional configuration

No `.env` file is required for the standard setup. To customize it, copy
[`.env.example`](../.env.example) to `.env` in the repository root. In PowerShell:

```powershell
Copy-Item .env.example .env
```

| Setting | Purpose |
| --- | --- |
| `JOBFATHER_PORT` | Browser port; defaults to `3000`. |
| `GEMINI_API_KEY` | Optional alternative to entering the key in Settings. A saved Settings key takes precedence. |
| `GEMINI_TEXT_MODEL` | Override the configured Gemini text model if your key requires another compatible model. |
| `GEMINI_LIVE_MODEL` | Override the Gemini Live model used for voice calls. |

Apply changes with `docker compose up -d --wait`. If you set
`JOBFATHER_PORT=3001`, open [localhost:3001](http://localhost:3001/).
Use the same `.env` for subsequent starts.

The root `.env` configures Docker Compose. `backend/.env` is only used for local
development. Secrets, runtime data, and local caches are excluded from Docker images.

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| Docker cannot connect to its daemon | Open Docker Desktop and wait for its engine to start. |
| App does not open | Run `docker compose ps` and `docker compose logs --tail=60`. Both services should be healthy. Check [API health](http://localhost:3000/api/health), which should return `{"status":"ok"}`. |
| Port 3000 is already in use | Set `JOBFATHER_PORT=3001` in `.env`, restart with `docker compose up -d --wait`, and open `http://localhost:3001/`. |
| Gemini key, model, or quota error | Check the key and its model access / quota in [Google AI Studio](https://aistudio.google.com/apikey). Adjust model overrides only if needed. |
| Résumé PDF cannot be read | Use **Paste text**. PDFs must be unlocked, at most 10 MB and 50 pages. |
| DOCX or LinkedIn PDF has no readable text | Use a text-based file or paste its text. |
| Job link cannot be imported | Use **Paste job description**, especially for postings behind a login. |
| Voice call cannot start | Allow microphone access on localhost and check Gemini Live model access. The workflow can also be completed through chat. |
| Drafts no longer match your profile | Choose **Update drafts** before revising the cover letter. |

First builds need internet access to download dependencies. AI features also need
internet access, a Gemini API key, and available provider quota.

## Local development without Docker

Use Node.js 22+ and Python 3.9+. From the repository root on macOS or Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000/). On Windows, use
`.venv\Scripts\python.exe` instead of `.venv/bin/python`.
The local database is `backend/data/profile.sqlite3`; the saved key is
`backend/data/gemini.key`. Settings reports key status without returning its value.
You can also put `GEMINI_API_KEY` and model overrides in `backend/.env`; restart the
backend after changing them. Profile URLs are saved as references, not imported evidence.

## Validation

```sh
.venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix frontend run typecheck
npm --prefix frontend run build
python3 scripts/smoke-docker.py
```

The backend regression tests mock Gemini and cover source validation, rejected
unsupported claims, document versions, and PDF text. The Docker smoke check
builds an isolated Compose project on a free port and checks API routing, profile
writes, key permissions, rejected cross-origin requests, and persistence after
container recreation. It removes only its disposable test volume. Neither makes
live Gemini requests. The Docker check is also configured in GitHub Actions.

## Package a source ZIP

```sh
python3 scripts/package-release.py
```

This creates `artifacts/thejobfather-judge-kit.zip` from the current source,
including uncommitted changes, while excluding private data, secrets, dependencies,
and Git history. Recipients extract it, open a terminal in the `thejobfather`
folder, and run `docker compose up --build -d --wait`.
