# TheJobFather

Hackathon MVP for creating an evidence-backed job application through a live,
interruptible conversation.

The planning baseline is intentionally smaller than the original specification.
It protects the product's defining loop:

1. Import real career evidence and a target job.
2. Discuss relevant experience by chat or call. Share a project screen during a
   call if it helps.
3. Review captured facts and add each relevant fact to the profile.
4. Generate and revise a tailored CV, cover letter, and fit analysis.
5. Download usable PDFs.

## Planning documents

- [Refined MVP specification](docs/MVP_SPEC.md)
- [Incremental delivery roadmap](docs/INCREMENTAL_ROADMAP.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Product decisions to confirm](docs/OPEN_DECISIONS.md)

## Current status

In **Profile**, choose a PDF or paste resume text, add optional GitHub and
LinkedIn profile links, and select **Save profile**.

In **Job**, import a public link or paste the posting. Gemini fills in the
role, company, description, and skills for you to review. **Start session** saves the
confirmed job and opens Session.

In **Session**, start a chat with Gemini about the confirmed job. New facts
appear in the footer. Edit a fact or add it to the profile individually.
The chat and fact list are saved with the confirmed job.

Choose **Call** for Gemini Live with captions and optional screen sharing.
Allow microphone access, then speak naturally to interrupt. Call captions
stay visible while the Session is open. Final user captions can produce
proposals in the same saved facts list. Only **Add to profile** saves a fact
to the profile. The browser sends microphone audio and selected screen frames
to Gemini using a short-lived token from the backend.

In **Application**, create a tailored CV, cover letter, and job fit from the saved
profile and confirmed job. Job fit includes the supporting profile excerpts.
Choose a letter tone and request a text revision. Each successful draft or revision
saves a version; the version selector restores an earlier one. Download the CV
and cover letter as selectable-text PDFs.

Drafts exclude unapproved Session facts. Generation checks source references,
numbers, skills, and fit requirements, then asks Gemini for a separate consistency
review. A failed check, changed input, or failed revision keeps the last successful
version. New profile changes require **Update drafts** before revising the letter.
Jobs run in the single local backend process; restarting it marks an interrupted
run as failed and preserves completed versions.

Run the app locally with Node.js 22+ and Python 3.9+. From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

```sh
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open [TheJobFather](http://127.0.0.1:3000). The app saves the original resume
and profile links in `data/profile.sqlite3`. Gemini extracts resume information
for sessions and drafts when you save a new resume. Profile links are saved as
URLs. A previous resume import can be used for sessions and drafts. Reupload
it to store a downloadable copy. Use the paste option for a locked PDF.

Open **Settings** to save a Gemini key from
[Google AI Studio](https://aistudio.google.com/app/apikey). The local backend
stores it in `data/gemini.key` with owner-only file permissions and uses it on
the next import. Settings returns the key status and never returns the value.
If no key is saved in Settings, the backend can use `GEMINI_API_KEY` from its
environment or the Git-ignored `backend/.env`. Set `GEMINI_TEXT_MODEL` there
to override the default `gemini-3.5-flash-lite`. Restart the backend after
changing environment settings. Set `GEMINI_LIVE_MODEL` to override the default
`gemini-3.8-live` if your key requires another compatible Live model.

This increment runs on loopback for a single local user. Owner sign-in and
spoken document revisions are still to be implemented.

Run the Application regression checks without a Gemini key:

```sh
.venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix frontend run typecheck
npm --prefix frontend run build
```
