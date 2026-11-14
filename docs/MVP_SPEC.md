# TheJobFather — Hackathon MVP Specification

- Status: Proposed MVP baseline
- Target: One-owner personal web app
- Build window: 10 hours
- Primary demo browser: Desktop Chrome
- Stack: Next.js, FastAPI, Gemini, SQLite, ReportLab, Codesphere

## 1. Product promise

TheJobFather turns a user's real career evidence into a tailored job application.
Its differentiator is not document templating by itself. It is a live,
interruptible conversation in which the agent can ask about work shown on a
shared screen, while the user remains the only authority who can add facts to
their career profile.

The hackathon story is:

> Show your work, explain what you did, approve what the agent learned, and use
> it immediately in a stronger job application.

## 2. MVP success condition

The MVP is successful when one person can complete this vertical slice in a
hosted build:

1. Sign in with the installation's owner password.
2. Upload one text-based resume PDF or paste resume text.
3. Check the details filled from the resume and save the profile.
4. Import a job link or paste the job description, then confirm the details.
5. Choose text chat or a call. On a call, speak, interrupt the agent, and
   optionally share a screen.
6. Receive an adaptive question about a missing job requirement or visible
   project detail.
7. Review captured facts in the conversation footer and add them to the
   profile individually.
8. Generate a tailored CV, cover letter, and evidence-linked fit analysis.
9. Request one spoken revision in the same live session.
10. Download valid CV and cover-letter PDFs whose claims come only from approved
    profile facts.

The demo is not complete if the live interaction is replaced by prerecorded,
push-to-talk, or text-only behavior without being clearly identified as a
fallback.

## 3. The core loop

The application flow has four screens. Use these labels in navigation and page
headings.

1. **Profile**. Upload a PDF and check the prefilled name, role, summary,
   recent experience, and skills. Offer pasted text if the PDF cannot be read.
   **Save and continue** confirms the edited profile in one action.
2. **Job**. Put the job link first, with **Import job** as the primary
   action. Show editable role, company, and description after a successful
   import. **Paste job description** is available if a link fails or the user
   already has the text. **Start session** confirms the job.
3. **Session**. Default to **Chat**, with **Call** beside it. Ask questions
   in the conversation itself. The call includes microphone controls, optional
   screen sharing, and a transcript. The shared **Captured facts** footer
   appends one row at a time as facts arrive. **Edit** updates a proposed fact.
   **Add to profile** confirms it individually and changes the row to **Added
   to profile** in place. Keep the full list in capture order when switching
   modes or ending the call. **Create drafts** uses the saved profile and
   confirmed job.
4. **Application**. Preview the CV, cover letter, and job fit. Show the supported
   evidence alongside each fit result. Let the user revise the cover letter
   and return to the previous version. **Download PDFs** exports the CV and
   cover letter.

The interactive mockup uses sample data and a simulated call. Its PDF control
shows the export action. The hosted build must perform the real import, call,
generation, and export checks in this spec.

Within Session, the primary loop is:

`question → answer/demonstration → proposed fact → explicit approval → generation/revision`

## 4. Feature list

### P0 — must work in the demo

#### Owner access and persistence

- One owner password per deployment.
- HttpOnly session cookie and same-origin frontend/backend requests.
- SQLite persistence for approved profile facts, confirmed jobs, applications,
  and document versions.
- Reopening an application shows its last successful document version.

#### Career evidence

- Upload one text-based resume PDF, maximum 10 MB.
- Pasted-text fallback for scanned, encrypted, or failed PDFs.
- Extract structured proposals for experience, education, skills, projects,
  and achievements.
- Every proposal includes its source and a short evidence excerpt.
- The user edits the extracted resume fields and confirms them together by
  saving the profile. Keep the evidence for those facts internally.
- Only confirmed profile details and explicitly added conversation facts
  enter the durable profile.

#### Target job

- Import the job from a public link, with paste as the fallback.
- Extract and display title, company, responsibilities, required qualifications,
  and optional qualifications.
- Let the user correct the extraction and explicitly confirm it.
- Generation is disabled until a job is confirmed.

#### Live conversation

- Text chat with the same question and fact-review flow as voice.
- Full-duplex live audio through Gemini Live.
- Natural interruption: user speech stops queued agent playback.
- Finalized captions for user and agent speech.
- Questions use the confirmed job, approved profile, and recent call context.
- The agent asks one concise question at a time and can respond differently when
  the user's claimed contribution changes.
- Optional browser screen sharing, sampled at a bounded rate of at most one JPEG
  frame per second.
- The agent may reference a visible detail, but must ask what the user personally
  did before proposing it as a career fact.
- Clear call, microphone, share-screen, reconnect, and connection-state controls.

#### Approval gate

- The live model can propose a fact but cannot approve it.
- A pending fact shows proposed wording, source (`resume` or `conversation`), and
  supporting excerpt.
- The footer keeps each captured fact visible during and after the conversation.
  An edit changes the proposal. **Add to profile** is the explicit approval
  action handled by FastAPI.
- Documents and durable memory use approved facts only.
- Correcting “six pipelines” to “four I migrated” creates only the corrected
  approved fact; the rejected wording is never used for generation.

#### Application generation

- Tone choice: Professional, Direct, or Warm.
- Generate structured CV, cover letter, and fit analysis from one pinned profile
  snapshot and one confirmed job snapshot.
- Fit status for each requirement is `supported`, `partial`, or `unknown`.
- Every CV bullet and material cover-letter assertion carries approved claim IDs
  internally.
- A validation pass blocks or flags unsupported skills, titles, dates, metrics,
  and contribution claims before results are shown as ready.
- One spoken revision can shorten, change tone, reorder emphasis, or select a
  different approved example.
- A successful revision creates a new document version; a failed revision leaves
  the previous version intact.

#### Output

- In-app tabs for CV, cover letter, and fit analysis.
- Deterministic, selectable-text PDF export for the CV and cover letter.
- One clean, single-column CV template.
- Evidence is visible inside the app but internal IDs are absent from exported
  documents.

#### Demo and deployment

- Synthetic resume, job, and expected model fixtures.
- Mocked text-model tests plus one verified real Gemini Live session.
- One Codesphere deployment over HTTPS with persistent SQLite storage.
- Exact local start and deployment instructions.

### P1 — implement only after the full P0 flow passes

- Import up to one selected public GitHub repository's description, languages,
  and bounded README excerpt; ask the user to confirm their personal work.
- LinkedIn exported PDF through the same PDF pipeline.
- Fit-analysis PDF.
- Camera frames sent to Gemini when screen sharing is inactive.
- Rich evidence drill-down and side-by-side document diff.
- More complete application history and profile fact editing.

### Later — explicitly outside the hackathon MVP

- Multiple users, OAuth, teams, billing, and role-based access.
- LinkedIn login or scraping.
- Private GitHub repositories, repository cloning, or code execution.
- Local filesystem access or project ZIP analysis.
- OCR, DOCX import, portfolios, and arbitrary social connectors.
- Automated job search, auto-apply, employer messaging, and interview coaching.
- Multiple CV templates, multilingual output, and DOCX export.
- Vector databases, microservices, and general autonomous-agent frameworks.
- Comprehensive deletion cascades, audit tooling, and production compliance
  certification. A clear “hackathon prototype” limitation must be shown instead.

## 5. Intentional reductions from the source specification

| Source-spec capability | MVP decision | Reason |
|---|---|---|
| Resume + LinkedIn + three GitHub repos + other material | Resume/paste is P0; LinkedIn and one GitHub repo are P1 | Multiple connectors do not prove the core loop |
| Job URL or paste | Paste is P0; URL fetch is P1 | Avoids spending the demo window on scraping and SSRF hardening |
| Audio + camera + screen | Audio + screen is P0; remote camera vision is P1 | Screen evidence is relevant to the product story; camera adds media risk without career evidence |
| Complete source/claim revocation graph | Approved fact snapshot and provenance | Enough to prevent unsupported generation in one-owner MVP |
| Fit PDF | Fit analysis in app; PDF is P1 | CV and letter are the employer-facing deliverables |
| Rich application browsing | Minimal saved application list | One end-to-end flow matters more than dashboard depth |
| Broad security and recovery matrix | Owner auth, secret isolation, input bounds, safe defaults | Production hardening is larger than the build window |

## 6. Rules the MVP must not compromise

1. **No invented facts.** Unknown stays unknown.
2. **The user approves facts.** A model call, spoken “yes,” or conversational
   implication is not approval.
3. **Job requirements are not user evidence.** They can only guide questions and
   matching.
4. **Screen content is untrusted input.** It cannot change system behavior or act
   as approval.
5. **Personal contribution must be explicit.** A visible technology or repository
   does not prove that the user built it or is proficient in it.
6. **Generation is snapshot-based.** CV, letter, and fit analysis use the same
   approved profile and job versions.
7. **Previous good work survives failure.** Failed generations and revisions do
   not overwrite the last successful version.
8. **Secrets stay server-side.** The permanent Gemini key is never shipped in the
   frontend bundle.

## 7. Minimal data model

Use UUID primary keys and UTC timestamps.

| Entity | Required fields |
|---|---|
| `source` | id, type, label, private path or pasted text, extracted text, content hash |
| `claim` | id, normalized field, value JSON, basis, evidence excerpt, source id, state |
| `profile_version` | id, version number, approved claim IDs, materialized profile JSON |
| `application` | id, raw job text, confirmed job JSON, job version, tone, created/updated timestamps |
| `call_session` | id, application id, pinned profile version, status, timestamps |
| `generation_run` | id, application/job/profile versions, parent run id, status, documents JSON, evidence map, validation results |

Pending live proposals may remain in process memory for the hackathon session.
Restart can discard pending proposals, but it must not discard approved claims or
successful documents. Do not persist raw audio, video, screen frames, or a full
raw transcript.

## 8. Minimal API surface

All routes except login and health require the owner session.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth/login` | Create owner session |
| `POST /api/v1/auth/logout` | Revoke session |
| `POST /api/v1/sources/file` | Extract resume PDF into proposals |
| `POST /api/v1/sources/text` | Extract pasted resume text into proposals |
| `GET /api/v1/profile` | Return approved profile and pending import proposals |
| `POST /api/v1/profile/approve` | Accept/edit/reject visible proposals against an expected profile version |
| `POST /api/v1/applications` | Create a job extraction preview from pasted text |
| `PATCH /api/v1/applications/{id}/job` | Confirm corrected job extraction |
| `GET /api/v1/applications` | List saved applications |
| `GET /api/v1/applications/{id}` | Restore application and latest successful run |
| `POST /api/v1/calls` | Start call and mint temporary Live credentials |
| `POST /api/v1/calls/{id}/actions` | Validate proposals and generation/revision requests from Live |
| `POST /api/v1/calls/{id}/end` | End the session and discard pending live state |
| `POST /api/v1/applications/{id}/generate` | Start structured document generation |
| `POST /api/v1/runs/{id}/revise` | Create a child document version from an approved revision action |
| `GET /api/v1/runs/{id}` | Poll generation and retrieve validated output |
| `GET /api/v1/runs/{id}/pdf?kind=cv|cover_letter` | Download a deterministic PDF |

Allowlisted Live actions are `propose_facts`, `set_tone`, `request_drafts`,
`revise_draft`, and `get_application_state`. The backend validates every action;
none may approve a fact, execute code, or fetch an arbitrary URL.

## 9. Acceptance criteria

The release candidate must pass these observable checks:

- Saved profile details survive server restart. Unsaved changes and pending
  conversation facts stay out of profile data and generated drafts.
- Chat and call append facts to the same footer. Saving one leaves its row
  visible in place, marked Added to profile.
- A confirmed job is required before generation.
- The live agent asks different follow-ups for “I built it” and “I observed it.”
- Interrupting the agent stops queued playback promptly.
- Stopping screen sharing stops frame transmission and releases the browser
  track.
- A screen-derived detail becomes only a pending proposal until a UI approval.
- CV, cover letter, and fit results reference the same profile and job versions.
- A fixture that tries to introduce an unsupported metric is blocked or clearly
  flagged before export.
- A failed revision preserves the last successful document version.
- Downloaded CV and cover-letter PDFs open, have selectable text, handle special
  characters, and contain no unresolved placeholders.
- Unauthenticated requests cannot read profile, application, call, run, or PDF
  data.
- The permanent Gemini key is absent from browser assets, network responses, and
  logs.
- One real hosted session proves audio, interruption, screen context, approval,
  generation, revision, and PDF download.

## 10. Demo script

Use synthetic data and keep the demo under five minutes:

1. Open an existing synthetic profile and show its approved resume facts.
2. Paste and confirm a job requiring CI/CD experience.
3. Start the call and share a project screen that visibly contains pipeline
   configuration.
4. Say, “I migrated six pipelines,” then interrupt and correct it: “Actually I
   migrated four; I only reviewed the other two.”
5. Edit/approve the pending fact as “Migrated four CI/CD pipelines.”
6. Generate all three outputs and open the evidence for the new CV bullet.
7. Say, “Make the letter shorter and more direct,” and show the new version.
8. Download both PDFs and verify that they say four, never six, and contain no
   invented impact metric.

## 11. Definition of done

“Done” means the hosted vertical slice passes the acceptance criteria with the
real configured Gemini models and actual PDFs. Mocked responses, screenshots, or
a recorded backup may support the presentation, but they cannot be reported as
proof that live functionality works.
