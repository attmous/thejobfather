# TheJobFather — Incremental Delivery Roadmap

The MVP will be built as a series of independently testable increments. Each
increment has a user-visible outcome, automated checks, and an exit gate. Work
does not proceed on top of a broken gate.

## Working agreement

- Keep `main` runnable at the end of every increment.
- Use synthetic data by default; never commit personal career data or API keys.
- Demo the increment before expanding its scope.
- Record what is verified, mocked, incomplete, or blocked.
- Carry unfinished optional work forward; do not hide it inside a “done” status.
- Preserve the explicit fact-approval boundary from the first data-bearing
  increment onward.

## Increment 0 — feasibility spike

**Outcome:** We know whether the defining live experience works with the actual
Gemini account, model, browser, and intended hosting path.

Build only a disposable thin slice:

- FastAPI issues a temporary Live credential.
- Desktop Chrome connects directly to Gemini Live.
- The user speaks, hears the agent, and sees finalized captions.
- User interruption clears agent playback.
- One user-selected screen frame reaches the model and produces a grounded
  observation.
- Codesphere serves a minimal HTTPS build and preserves a test file across a
  restart.

**Exit gate:** Real audio, interruption, screen context, credential isolation,
HTTPS permissions, and persistence are verified. If this gate fails, stop and
report the exact provider or hosting constraint before building product UI.

## Increment 1 — runnable application skeleton

**Outcome:** The owner can sign in and move through the empty product flow.

- Next.js and FastAPI projects with pinned dependencies.
- Local start commands and environment validation.
- Owner-password login and HttpOnly session.
- SQLite initialization, health check, and restart test.
- Empty Profile, Job, Session, and Application screens.
- Shared API error handling and loading states.

**Demo:** Sign in, navigate every screen, reload the app, and sign out.

**Exit gate:** Authenticated routes reject anonymous requests; local automated
tests and production builds pass.

## Increment 2 — approved career profile

**Outcome:** The owner can turn resume evidence into durable, approved facts.

- Text-based resume PDF upload with size/signature checks.
- Pasted resume-text fallback.
- Strict structured extraction through the text model adapter.
- Editable profile details prefilled from the resume, with evidence kept
  internally.
- Save and continue confirms the profile in one action.
- Atomic profile version creation with stale-version protection.

**Demo:** Import a synthetic resume, correct the extracted details, save the
profile, restart, and verify the saved details.

**Exit gate:** Unsaved claims cannot appear through the approved profile API.
Mocked extraction, save, and restart tests pass.

## Increment 3 — confirmed target job

**Outcome:** The owner can create a saved application from a reviewed job
posting.

- Job link import with pasted description fallback.
- Strict extraction of role, company, and stable requirement IDs.
- Editable confirmation step.
- Saved application detail and minimal application list.
- UI gates preventing generation before confirmation.

**Demo:** Import a synthetic job, correct the details, confirm it, and reopen the
saved application.

**Exit gate:** Job requirements never enter career claims; unconfirmed jobs cannot
start generation.

## Increment 4 — live career conversation

**Outcome:** Chat and Call ask adaptive questions using the approved profile and
confirmed job.

- Production `LiveSession` state machine based on Increment 0.
- Microphone capture, agent playback, captions, interruption, reconnect, and
  complete media cleanup.
- Pinned profile/job context.
- One-question-at-a-time conversation policy.
- Different follow-up behavior for builder versus observer answers.

**Demo:** Start a call about the saved application, answer a relevance question,
interrupt the agent, redirect the conversation, and end cleanly.

**Exit gate:** No raw media is persisted; late events from an interrupted or ended
session cannot change current UI state.

## Increment 5 — screen evidence and live approval

**Outcome:** The agent can discuss visible work and propose—but never self-approve
—a new career fact.

- User-gesture screen selection and bounded frame sampling.
- Clear sharing indicator and stop behavior.
- Allowlisted `propose_facts` action.
- Shared Captured facts footer. Append proposals one at a time and keep them
  visible with their source and saved status after approval.
- Backend approval action and refreshed live context after success.

**Demo:** Share a project screen, explain personal contribution, correct “six” to
“four,” approve only the corrected fact, and show it in the profile.

**Exit gate:** A model action and spoken agreement cannot approve a claim. Stopped
sharing stops frame transmission and releases the track.

## Increment 6 — evidence-backed application drafts

**Outcome:** The owner receives a tailored CV, cover letter, and transparent fit
analysis.

- Tone selector.
- Structured generation from one profile/job snapshot pair.
- Claim IDs on factual document blocks.
- Categorical fit analysis with requirement IDs.
- Deterministic checks plus a separate consistency review.
- Saved generation states and evidence drill-down.

**Demo:** Generate all outputs, inspect evidence for a CV bullet, and show an
unknown job requirement without invented experience.

**Exit gate:** Unsupported skill, metric, title, date, and contribution fixtures
are blocked or flagged. A failed run does not remove the last successful run.

## Increment 7 — spoken revision and final PDFs

**Outcome:** The owner can refine the application in the same call and download
usable files.

- Allowlisted `revise_draft` action.
- Child versions that preserve the previous successful draft.
- New facts route back through approval rather than entering a revision.
- Fixed ReportLab CV and cover-letter templates.
- PDF text, Unicode, page-break, and long-content checks.

**Demo:** Say “Make the letter shorter and more direct,” compare versions, and
download PDFs containing the corrected fact.

**Exit gate:** Both PDFs open with selectable unclipped text, no placeholders, no
internal IDs, and no unapproved assertions.

## Increment 8 — hosted demo release

**Outcome:** The complete vertical slice is repeatable on the hosted build.

- Codesphere environment and same-origin proxy.
- Persistent SQLite and private data directory.
- Failure-state checks for permissions, disconnect, malformed model responses,
  and provider timeouts.
- Exact setup, recovery, and deployment documentation.
- Full synthetic rehearsal and visual PDF inspection.
- Clearly labeled recorded backup after the real path passes.

**Demo:** Run the five-minute script in `MVP_SPEC.md` from login through downloads.

**Exit gate:** Hosted acceptance checks pass after a restart and verified behavior
is separated from known limitations in the release notes.

## Optional increments after the MVP

Add these one at a time, with the same build/demo/gate discipline:

1. One selected public GitHub repository.
2. LinkedIn exported PDF.
4. Remote camera vision.
5. Fit-analysis PDF.
6. Rich history, evidence view, and document diff.

## Recommended review points

The user should review the product after Increments 0, 2, 5, 6, and 8. These
checkpoints answer the major questions in order: feasibility, evidence quality,
conversation quality, document quality, and hosted reliability.
